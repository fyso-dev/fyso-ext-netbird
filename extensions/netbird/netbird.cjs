// This project's web addresses through NetBird (fyso-ext-netbird).
//   forward  relay <NetBird IP>:<gateway port> to the loopback gateway, peers only
//   plan     show what each address needs in NetBird; changes nothing
//   apply    create what is missing and update what drifted; never deletes
// Two ways in, chosen by the `access` answer:
//   private  DNS records in a NetBird zone point the addresses at this peer; host,
//            port and scheme stay the same end to end, plain HTTP inside WireGuard
//            (framework D61).
//   https    HTTPS provider (framework D62): one NetBird reverse proxy service per
//            address terminates TLS and reaches the relay with the same Host. The
//            conf.d file sets FYSO_WEB_SCHEME=https, which is what selects it here.
// Runs through run-ext.sh: FYSO_* and NETBIRD_API_TOKEN only.
const fs = require('node:fs');
const net = require('node:net');
const {execFileSync} = require('node:child_process');

const env = process.env;
const domain = env.FYSO_WEB_DOMAIN || '';
const port = Number(env.FYSO_HTTP_PORT);
const https = env.FYSO_WEB_SCHEME === 'https';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function status() {
  const s = JSON.parse(execFileSync('netbird', ['status', '--json'], {encoding: 'utf8'}));
  if (!s.management?.connected) throw Error('NetBird is not connected to its management service');
  return {api: new URL(s.management.url).origin, ip: s.netbirdIp.split('/')[0]};
}

function requireDomain() {
  if (!domain || domain.endsWith('.localhost')) {
    throw Error(`web_domain is ${domain || 'empty'}: answer web_domain with ${https ? 'a name under the reverse proxy domain, such as host1.proxy.example.com' : 'a name in a NetBird DNS zone'} (copier update -d web_domain=…)`);
  }
  // Without the framework's public scheme (D62) the login would redirect to http.
  if (https && !fs.existsSync(`${env.FYSO_ROOT}/framework/scripts/web-origin.cjs`)) {
    throw Error('HTTPS access needs a framework with D62 (public web scheme): update the framework first');
  }
}

// NetBird peers live in the CGNAT range; nothing else may use the relay.
const peerAddress = address => {
  const m = /^(?:::ffff:)?100\.(\d+)\.\d+\.\d+$/.exec(address || '');
  return Boolean(m) && Number(m[1]) >= 64 && Number(m[1]) <= 127;
};

function forward() {
  requireDomain();
  const {ip} = status();
  const server = net.createServer(client => {
    if (!peerAddress(client.remoteAddress)) return client.destroy();
    const upstream = net.connect(port, '127.0.0.1');
    client.pipe(upstream).pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close);
    upstream.on('error', close);
  });
  // The NetBird interface can go away; process-compose restarts the relay.
  server.on('error', error => { console.error(error.message); process.exit(1); });
  server.listen(port, ip, () => console.log(`Relaying ${ip}:${port} to the gateway for NetBird peers.`));
}

// Addresses the gateway serves: the login, the panel and every app on this domain.
function hosts() {
  const project = readJson(`${env.FYSO_DATA}/panel/project.json`);
  const apps = readJson(`${env.FYSO_DATA}/panel/apps.json`).filter(a => a.enabled !== false);
  const names = [...Object.values(project.urls || {}), ...apps.map(a => a.url)]
    .map(url => { try { return new URL(url).hostname; } catch { return ''; } })
    .filter(host => host.endsWith(`.${domain}`));
  return [...new Set(names)].sort();
}

async function api(base, method, path, body) {
  if (!env.NETBIRD_API_TOKEN) throw Error('NETBIRD_API_TOKEN is empty: set it with mise run secrets');
  const res = await fetch(`${base}/api${path}`, {method, body: body && JSON.stringify(body),
    headers: {Authorization: `Token ${env.NETBIRD_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json'}});
  const text = await res.text();
  if (!res.ok) throw Error(`NetBird API ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Fields a ServiceRequest accepts; an update resends the existing ones unchanged.
const REQUEST = ['name', 'domain', 'mode', 'listen_port', 'targets', 'enabled', 'pass_host_header',
  'rewrite_redirects', 'auth', 'access_restrictions', 'private', 'access_groups'];
const ACCESS = ['auth', 'access_restrictions', 'private', 'access_groups'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
const restricted = s => Boolean(s.private || s.access_restrictions
  || Object.values(s.auth || {}).some(a => a && a.enabled));

// Who can open the addresses is the NetBird administrator's decision; say what it is.
function accessNotice(cluster, services) {
  const open = services.filter(s => !restricted(s)).map(s => s.domain);
  if (!open.length) return [];
  return [
    `Public: ${open.length} address(es) of this project answer anyone on the internet, protected only by the project's login.`,
    cluster.private === false || cluster.supports_private === false
      ? `The proxy cluster ${cluster.address} does not offer NetBird-only access. Its administrator can enable it, or restrict each service (SSO groups, IP ranges) in the NetBird dashboard.`
      : 'Restrict them in the NetBird dashboard (NetBird-only access, SSO groups, IP ranges).',
  ];
}

async function syncServices(apply) {
  const {api: base, ip} = status();
  // The proxy cluster that serves web_domain, which must be a name under its address.
  const clusters = await api(base, 'GET', '/reverse-proxies/clusters');
  const cluster = clusters.filter(c => c.online && domain.endsWith(`.${c.address}`))
    .sort((a, b) => b.address.length - a.address.length)[0];
  if (!cluster) {
    const online = clusters.filter(c => c.online).map(c => c.address);
    throw Error(online.length
      ? `web_domain ${domain} is not under an online reverse proxy cluster (${online.join(', ')}): answer it with a name such as host1.${online[0]}`
      : 'This NetBird account has no online reverse proxy cluster');
  }
  const peer = (await api(base, 'GET', '/peers')).find(p => p.ip === ip);
  if (!peer) throw Error(`No NetBird peer with IP ${ip}`);
  const services = await api(base, 'GET', '/reverse-proxies/services');
  const target = {target_id: peer.id, target_type: 'peer', protocol: 'http', port, enabled: true};
  const wanted = hosts();
  // New services take the access settings of this project's existing ones, if any.
  const reference = services.find(s => wanted.includes(s.domain));
  const result = [];
  let changes = 0;
  for (const host of wanted) {
    const current = services.find(s => s.domain === host);
    const t = current?.targets?.[0];
    if (current && current.targets?.length === 1 && t.target_id === peer.id && t.port === port
        && t.protocol === 'http' && current.pass_host_header && current.enabled) {
      console.log(`  ok      https://${host}`);
      result.push(current);
      continue;
    }
    changes++;
    if (!current) {
      const body = {name: host, domain: host, mode: 'http', enabled: true, pass_host_header: true,
        targets: [target], ...(reference ? pick(reference, ACCESS) : {})};
      console.log(`  create  https://${host}${reference ? ` (access as ${reference.domain})` : ''}`);
      if (apply) await api(base, 'POST', '/reverse-proxies/services', body);
      result.push(body);
    } else {
      const body = {...pick(current, REQUEST), targets: [target], enabled: true, pass_host_header: true};
      console.log(`  update  https://${host} (target ${t ? `${t.target_type}:${t.port}` : 'none'} -> peer:${port})`);
      if (apply) await api(base, 'PUT', `/reverse-proxies/services/${encodeURIComponent(current.id)}`, body);
      result.push(body);
    }
  }
  console.log(changes ? `${changes} change(s) ${apply ? 'applied' : 'planned; run apply to make them'}.` : 'Nothing to change.');
  for (const line of accessNotice(cluster, result)) console.log(`! ${line}`);
}

async function sync(apply) {
  requireDomain();
  if (https) return syncServices(apply);
  const {api: base, ip} = status();
  // The most specific zone that holds web_domain; NetBird pushes it to its peers.
  const zone = (await api(base, 'GET', '/dns/zones'))
    .filter(z => z.enabled !== false && (domain === z.domain || domain.endsWith(`.${z.domain}`)))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
  if (!zone) throw Error(`No NetBird DNS zone holds ${domain}: create one (Dashboard → DNS → Zones) for a parent of it`);
  const zonePath = `/dns/zones/${encodeURIComponent(zone.id)}/records`;
  const records = await api(base, 'GET', zonePath);
  let changes = 0;
  for (const host of hosts()) {
    const current = records.filter(r => r.name === host && r.type === 'A');
    if (current.length === 1 && current[0].content === ip) {
      console.log(`  ok      ${host} -> ${ip}`);
      continue;
    }
    changes++;
    const body = {name: host, type: 'A', content: ip, ttl: 300};
    if (!current.length) {
      console.log(`  create  ${host} -> ${ip}`);
      if (apply) await api(base, 'POST', zonePath, body);
    } else {
      console.log(`  update  ${host} -> ${ip} (was ${current.map(r => r.content).join(', ')})`);
      if (apply) await api(base, 'PUT', `${zonePath}/${encodeURIComponent(current[0].id)}`, body);
    }
  }
  console.log(changes ? `${changes} change(s) ${apply ? 'applied' : 'planned; run apply to make them'}.` : 'Nothing to change.');
}

const command = process.argv[2];
(command === 'forward' ? Promise.resolve(forward()) :
  command === 'plan' || command === 'apply' ? sync(command === 'apply') :
  Promise.reject(Error('usage: netbird.cjs forward|plan|apply')))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
