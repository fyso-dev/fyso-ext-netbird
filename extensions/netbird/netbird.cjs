// This project's web addresses for NetBird peers (fyso-ext-netbird).
//   forward  relay <NetBird IP>:<gateway port> to the loopback gateway, peers only
//   plan     show the DNS records each address needs; changes nothing
//   apply    create missing records and update drifted ones; never deletes
// The gateway keeps its own host, port and scheme end to end, so the project's
// web login works unchanged (framework D61). Runs through run-ext.sh: FYSO_* and
// NETBIRD_API_TOKEN only.
const fs = require('node:fs');
const net = require('node:net');
const {execFileSync} = require('node:child_process');

const env = process.env;
const domain = env.FYSO_WEB_DOMAIN || '';
const port = Number(env.FYSO_HTTP_PORT);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function status() {
  const s = JSON.parse(execFileSync('netbird', ['status', '--json'], {encoding: 'utf8'}));
  if (!s.management?.connected) throw Error('NetBird is not connected to its management service');
  return {api: new URL(s.management.url).origin, ip: s.netbirdIp.split('/')[0]};
}

function requireDomain() {
  if (!domain || domain.endsWith('.localhost')) {
    throw Error(`web_domain is ${domain || 'empty'}: answer web_domain with a name in a NetBird DNS zone (copier update -d web_domain=…)`);
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

async function sync(apply) {
  requireDomain();
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
