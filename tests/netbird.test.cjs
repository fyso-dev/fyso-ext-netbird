// plan/apply against a fake NetBird management API and a fake `netbird` client.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const {spawn} = require('node:child_process');
const script = path.resolve(__dirname, '../extensions/netbird/netbird.cjs');

async function fixture(t, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-netbird-'));
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      calls.push({method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null});
      const routes = {'/api/reverse-proxies/clusters': state.clusters, '/api/peers': [{id: 'peer-1', ip: '100.94.0.7'}],
        '/api/reverse-proxies/services': state.services, '/api/dns/zones': state.zones || [], '/api/dns/zones/z1/records': state.records || []};
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.method === 'GET' ? routes[req.url] ?? [] : {}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin/netbird'), `#!/bin/sh\necho '${JSON.stringify({management: {connected: true, url: `http://127.0.0.1:${server.address().port}`}, netbirdIp: '100.94.0.7/16'})}'\n`, {mode: 0o755});
  fs.mkdirSync(path.join(dir, 'panel'));
  fs.mkdirSync(path.join(dir, 'framework/scripts'), {recursive: true});
  if (state.d62 !== false) fs.writeFileSync(path.join(dir, 'framework/scripts/web-origin.cjs'), '');
  const scheme = state.https ? 'https' : 'http', suffix = state.https ? '' : ':8460';
  const url = app => `${scheme}://${app}.${state.domain}${suffix}`;
  fs.writeFileSync(path.join(dir, 'panel/project.json'), JSON.stringify({urls: {panel: url('panel'), auth: url('auth'), dagu: url('dagu'), omb: url('omb')}}));
  fs.writeFileSync(path.join(dir, 'panel/apps.json'), JSON.stringify([{id: 'docs', url: url('docs')}, {id: 'off', url: url('off'), enabled: false}, {id: 'ext', url: 'https://elsewhere.example.com'}]));
  // Async: the fake API lives in this process, which a synchronous child would block.
  const run = command => new Promise(resolve => {
    const child = spawn(process.execPath, [script, command], {env: {
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FYSO_ROOT: dir, FYSO_DATA: dir, FYSO_HTTP_PORT: '8460',
      FYSO_WEB_DOMAIN: state.domain, NETBIRD_API_TOKEN: 'fixture-token', ...(state.https ? {FYSO_WEB_SCHEME: 'https'} : {})}});
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    child.on('close', status => resolve({status, stdout, stderr}));
  });
  return {run, calls};
}
const cluster = {address: 'proxy.example.com', online: true, private: false};
const writes = calls => calls.filter(c => c.method !== 'GET');

test('https: plan lists one service per address and changes nothing', async t => {
  const {run, calls} = await fixture(t, {https: true, domain: 'host1.proxy.example.com', clusters: [cluster], services: []});
  const r = await run('plan');
  assert.equal(r.status, 0, r.stderr);
  for (const app of ['auth', 'dagu', 'docs', 'omb', 'panel']) assert.match(r.stdout, new RegExp(`create  https://${app}\\.host1\\.proxy\\.example\\.com`));
  assert.doesNotMatch(r.stdout, /off\.host1|elsewhere/);
  assert.match(r.stdout, /5 change\(s\) planned/);
  assert.equal(writes(calls).length, 0);
  assert.ok(!r.stdout.includes('fixture-token'));
});

test('https: apply creates services that keep the Host and reach the gateway port', async t => {
  const {run, calls} = await fixture(t, {https: true, domain: 'host1.proxy.example.com', clusters: [cluster], services: []});
  const r = await run('apply');
  assert.equal(r.status, 0, r.stderr);
  const posts = writes(calls);
  assert.equal(posts.length, 5);
  for (const c of posts) {
    assert.equal(c.method, 'POST'); assert.equal(c.url, '/api/reverse-proxies/services'); assert.equal(c.auth, 'Token fixture-token');
    assert.equal(c.body.pass_host_header, true); assert.equal(c.body.mode, 'http');
    assert.deepEqual(c.body.targets, [{target_id: 'peer-1', target_type: 'peer', protocol: 'http', port: 8460, enabled: true}]);
  }
});

test('https: public addresses are announced, with the cluster limit', async t => {
  const {run} = await fixture(t, {https: true, domain: 'host1.proxy.example.com', clusters: [cluster], services: []});
  const r = await run('plan');
  assert.match(r.stdout, /! Public: 5 address\(es\)/);
  assert.match(r.stdout, /! The proxy cluster proxy\.example\.com does not offer NetBird-only access/);
});

test('https: existing services are kept, their access is copied and restricted ones raise no notice', async t => {
  const existing = app => ({id: `id-${app}`, name: app, domain: `${app}.host1.proxy.example.com`, mode: 'http', enabled: true, pass_host_header: true, private: true, access_groups: ['g1'],
    targets: [{target_id: 'peer-1', target_type: 'peer', protocol: 'http', port: 8460, enabled: true}]});
  const {run, calls} = await fixture(t, {https: true, domain: 'host1.proxy.example.com', clusters: [{...cluster, private: true}],
    services: ['auth', 'dagu', 'omb', 'panel'].map(existing)});
  const r = await run('apply');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok      https:\/\/panel\.host1/);
  const posts = writes(calls);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.domain, 'docs.host1.proxy.example.com');
  assert.equal(posts[0].body.private, true); assert.deepEqual(posts[0].body.access_groups, ['g1']);
  assert.doesNotMatch(r.stdout, /^! /m);
});

test('https: a drifted target is updated in place', async t => {
  const old = {id: 'id-panel', name: 'panel', domain: 'panel.host1.proxy.example.com', mode: 'http', enabled: true, pass_host_header: true,
    auth: {password_auth: {enabled: true}}, targets: [{target_id: 'peer-1', target_type: 'peer', protocol: 'http', port: 8475, enabled: true}]};
  const {run, calls} = await fixture(t, {https: true, domain: 'host1.proxy.example.com', clusters: [cluster], services: [old]});
  const r = await run('apply');
  assert.equal(r.status, 0, r.stderr);
  const put = writes(calls).find(c => c.method === 'PUT');
  assert.equal(put.url, '/api/reverse-proxies/services/id-panel');
  assert.equal(put.body.targets[0].port, 8460); assert.deepEqual(put.body.auth, old.auth);
});

test('https: web_domain outside every online cluster is refused with a usable hint', async t => {
  const {run, calls} = await fixture(t, {https: true, domain: 'host1.corp.internal', clusters: [cluster], services: []});
  const r = await run('apply');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not under an online reverse proxy cluster \(proxy\.example\.com\).*host1\.proxy\.example\.com/);
  assert.equal(writes(calls).length, 0);
});

test('https: a framework without the public scheme is refused', async t => {
  const {run} = await fixture(t, {https: true, d62: false, domain: 'host1.proxy.example.com', clusters: [cluster], services: []});
  const r = await run('plan');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /needs a framework with D62/);
});

test('private: DNS records are still what gets planned', async t => {
  const {run, calls} = await fixture(t, {domain: 'host1.corp.internal', clusters: [cluster], services: [], zones: [{id: 'z1', domain: 'corp.internal'}]});
  const r = await run('plan');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /create  panel\.host1\.corp\.internal -> 100\.94\.0\.7/);
  assert.ok(!calls.some(c => c.url.includes('reverse-proxies')));
});
