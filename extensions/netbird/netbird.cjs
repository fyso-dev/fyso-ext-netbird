// NetBird reverse proxy services for this project's apps (fyso-ext-netbird).
//   config  write the remote launcher metadata (app links on public names)
//   plan    show the services each app needs; changes nothing
//   apply   create missing services and update drifted ones; never deletes
// Runs through run-ext.sh: FYSO_* and NETBIRD_API_TOKEN only.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');

const env = process.env;
const domain = env.FYSO_EXT_NETBIRD_DOMAIN;
const suffix = env.FYSO_EXT_NETBIRD_SUFFIX || '';
const port = Number(env.FYSO_EXT_NETBIRD_PORT);
const aliases = JSON.parse(env.FYSO_EXT_NETBIRD_ALIASES || '{}');
const out = `${env.FYSO_DATA}/ext/netbird`;

// Apps the gateway serves as <sub>.localhost; the panel itself is "panel".
const subdomain = url => (/^https?:\/\/([a-z][a-z0-9-]*)\.localhost(:\d+)?\/?$/.exec(url || '') || [])[1];
const publicName = sub => (aliases[sub] || sub) + (suffix ? `-${suffix}` : '');
const publicUrl = sub => `https://${publicName(sub)}.${domain}`;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function exposed() {
  const apps = readJson(`${env.FYSO_DATA}/panel/apps.json`).filter(a => a.enabled !== false && subdomain(a.url));
  return ['panel', ...new Set(apps.map(a => subdomain(a.url)))];
}

function config() {
  const apps = readJson(`${env.FYSO_DATA}/panel/apps.json`)
    .map(a => subdomain(a.url) ? {...a, url: publicUrl(subdomain(a.url))} : a);
  const project = readJson(`${env.FYSO_DATA}/panel/project.json`);
  project.urls = Object.fromEntries(Object.entries(project.urls || {})
    .map(([k, url]) => [k, subdomain(url) ? publicUrl(subdomain(url)) : url]));
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(`${out}/apps.json`, JSON.stringify(apps));
  fs.writeFileSync(`${out}/project.json`, JSON.stringify(project));
  console.log(`Remote launcher metadata written for ${apps.length} apps.`);
}

function status() {
  const s = JSON.parse(execFileSync('netbird', ['status', '--json'], {encoding: 'utf8'}));
  if (!s.management?.connected) throw Error('NetBird is not connected to its management service');
  return {api: new URL(s.management.url).origin, ip: s.netbirdIp.split('/')[0]};
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

async function sync(apply) {
  const {api: base, ip} = status();
  const peer = (await api(base, 'GET', '/peers')).find(p => p.ip === ip);
  if (!peer) throw Error(`No NetBird peer with IP ${ip}`);
  const services = await api(base, 'GET', '/reverse-proxies/services');
  const target = {target_id: peer.id, target_type: 'peer', protocol: 'http', port, enabled: true};
  const wanted = exposed().map(sub => ({sub, domain: `${publicName(sub)}.${domain}`}));
  // New services take the access settings of this project's existing ones, if any.
  const reference = services.find(s => wanted.some(w => w.domain === s.domain));
  let changes = 0;
  for (const {sub, domain: host} of wanted) {
    const current = services.find(s => s.domain === host);
    const t = current?.targets?.[0];
    if (current && current.targets?.length === 1 && t.target_id === peer.id && t.port === port
        && t.protocol === 'http' && current.pass_host_header && current.enabled) {
      console.log(`  ok      ${host} -> ${sub}`);
      continue;
    }
    changes++;
    if (!current) {
      const body = {name: publicName(sub), domain: host, mode: 'http', enabled: true, pass_host_header: true,
        targets: [target], ...(reference ? pick(reference, ACCESS) : {})};
      console.log(`  create  ${host} -> ${sub} (port ${port}${reference ? `, access as ${reference.domain}` : ', no proxy auth'})`);
      if (apply) await api(base, 'POST', '/reverse-proxies/services', body);
    } else {
      const body = {...pick(current, REQUEST), targets: [target], enabled: true, pass_host_header: true};
      console.log(`  update  ${host} -> ${sub} (target ${t ? `${t.target_type}:${t.port}` : 'none'} -> peer:${port})`);
      if (apply) await api(base, 'PUT', `/reverse-proxies/services/${encodeURIComponent(current.id)}`, body);
    }
  }
  console.log(changes ? `${changes} change(s) ${apply ? 'applied' : 'planned; run apply to make them'}.` : 'Nothing to change.');
  config();
}

const command = process.argv[2];
(command === 'config' ? Promise.resolve(config()) :
  command === 'plan' || command === 'apply' ? sync(command === 'apply') :
  Promise.reject(Error('usage: netbird.cjs config|plan|apply')))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
