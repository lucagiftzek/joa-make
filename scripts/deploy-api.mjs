#!/usr/bin/env node
// Deploy the Make custom app in joa-integrations/make/src to Make via the SDK Apps REST API,
// mirroring "Deploy to Make" of the Make Apps Editor VS Code extension (Integromat.apps-sdk).
// No tokens handled here: MAKE_API points at a local proxy that injects Authorization.
//
// Usage:
//   node make-deploy.mjs [deploy] [--dry-run] [--only <component>] [--src DIR] [--wrap-app]
//   node make-deploy.mjs info
//   node make-deploy.mjs raw <METHOD> <path> [file]      (path relative to MAKE_API, e.g. /sdk/apps)
// Env: MAKE_API (default http://127.0.0.1:18777/api/v2), MAKE_MAPPING (mapping file path)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.MAKE_API || 'http://127.0.0.1:18777/api/v2').replace(/\/+$/, '');
const MAPPING_FILE = process.env.MAKE_MAPPING || path.join(HERE, '..', '.make-mapping.json');

const APP = {
  name: process.env.MAKE_APP || 'job-opportunities-api-aniywx',
  version: 1,
  label: 'Job Opportunities API (JOA)',
  description: 'Employer-direct job postings from company career sites, with every closure tracked.',
  theme: '#2563eb',
  language: 'en',
};

// Source of truth: vscode-apps-sdk src/services/module-types-naming.ts
const TYPE_ID = { trigger: 1, action: 4, search: 9, instant_trigger: 10, responder: 11, universal: 12 };
// Source of truth: vscode-apps-sdk src/services/component-code-def.ts (codeFiles key -> API section + mimetype)
const JSONC = 'application/jsonc';
const SECTIONS = {
  connection: { communication: ['api', JSONC], params: ['parameters', JSONC], common: ['common', 'application/json'],
    scopeList: ['scopes', JSONC], defaultScope: ['scope', JSONC], installSpec: ['installSpec', JSONC], installDirectives: ['install', JSONC] },
  module: { communication: ['api', JSONC], epoch: ['epoch', JSONC], staticParams: ['parameters', JSONC],
    mappableParams: ['expect', JSONC], interface: ['interface', JSONC], samples: ['samples', JSONC], scope: ['scope', JSONC] },
  rpc: { communication: ['api', JSONC], params: ['parameters', JSONC] },
};
const GENERAL = { base: ['base', JSONC], common: ['common', 'application/json'], readme: ['readme', 'text/markdown'], groups: ['groups', 'application/json'] };

// ---- args
const argv = process.argv.slice(2);
const flags = { dry: false, only: null, src: null, wrap: false };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') flags.dry = true;
  else if (a === '--only') flags.only = argv[++i];
  else if (a === '--src') flags.src = argv[++i];
  else if (a === '--wrap-app') flags.wrap = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 11).join('\n')); process.exit(0); }
  else pos.push(a);
}
const SRC = flags.src || path.join(HERE, '..', 'src');
const cmd = pos[0] || 'deploy';

// ---- http
let n = 0;
async function call(method, p, { body, type, okStatuses = [], quiet = false } = {}) {
  const url = API + p;
  const bodyStr = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  const ct = bodyStr === undefined ? undefined : (type || 'application/json');
  const tag = String(++n).padStart(3, '0');
  if (flags.dry) {
    console.log(tag + ' [dry] ' + method + ' ' + p + (ct ? '  (' + ct + ', ' + bodyStr.length + ' bytes)' : ''));
    if (bodyStr !== undefined && (ct === 'application/json') && bodyStr.length < 600) console.log('        body: ' + bodyStr);
    return { status: 0, dry: true, data: null };
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method, headers: ct ? { 'Content-Type': ct, Accept: 'application/json' } : { Accept: 'application/json' }, body: bodyStr });
    const text = await res.text();
    if (res.status === 429 && attempt < 5) {
      const wait = (Number(res.headers.get('retry-after')) || 5) * 1000;
      console.log(tag + ' ' + method + ' ' + p + ' -> 429, waiting ' + wait + 'ms');
      await new Promise(r => setTimeout(r, wait)); continue;
    }
    if (!quiet) console.log(tag + ' ' + method + ' ' + p + ' -> ' + res.status);
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok && !okStatuses.includes(res.status)) {
      console.error('FAILED ' + method + ' ' + p + ' -> HTTP ' + res.status + '\n' + text);
      process.exit(1);
    }
    return { status: res.status, data, text };
  }
}

// ---- helpers
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const camel = s => s.replace(/-+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
const firstArray = d => { if (Array.isArray(d)) return d; if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) return v; return []; };
const loadMapping = () => { try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8')); } catch { return {}; } };
function saveMapping(m) { if (flags.dry) return; fs.mkdirSync(path.dirname(MAPPING_FILE), { recursive: true }); fs.writeFileSync(MAPPING_FILE, JSON.stringify(m, null, 2) + '\n'); }
// rewrite rpc://<local-kebab-id> to the remote camelCase rpc name
const fileText = rel => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/rpc:\/\/([a-z0-9]+(?:-[a-z0-9]+)+)/g, (m, id) => 'rpc://' + id.replace(/-([a-z0-9])/g, (x, c) => c.toUpperCase()));

async function putCode(urlPath, rel, mime) {
  await call('PUT', urlPath, { body: fileText(rel), type: mime });
}
const appPath = '/sdk/apps/' + APP.name + '/' + APP.version;

async function main() {
  if (cmd === 'info') {
    const r = await call('GET', appPath + '?cols[]=name&cols[]=label&cols[]=version&cols[]=public&cols[]=approved&cols[]=inviteToken&cols[]=created&cols[]=origin&cols[]=flags', { quiet: true });
    console.log(JSON.stringify(r.data, null, 2)); return;
  }
  if (cmd === 'raw') {
    const [, method, p, file] = pos;
    if (!method || !p) throw new Error('usage: raw <METHOD> <path> [file]');
    let body, type;
    if (file) {
      body = fs.readFileSync(file, 'utf8');
      type = /\.jsonc$/.test(file) ? JSONC : /\.md$/.test(file) ? 'text/markdown' : /\.js$/.test(file) ? 'application/javascript' : 'application/json';
    }
    const r = await call(method.toUpperCase(), p.startsWith('/') ? p : '/' + p, { body, type, okStatuses: [] });
    if (!flags.dry) console.log(typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2));
    return;
  }
  if (cmd !== 'deploy') throw new Error('unknown command ' + cmd);

  const mf = readJson(path.join(SRC, 'makecomapp.json'));
  const mapping = loadMapping();
  for (const t of ['connection', 'module', 'rpc']) mapping[t] ||= {};
  const only = flags.only;
  const want = (type, id) => !only || only === type || only === type + ':' + id || only === id || (only === 'app' && type === 'app');
  const ph = (t, id) => mapping[t][id] || '<remote:' + t + ':' + id + '>';

  // 1. app
  const doApp = !only || ['app', 'general'].includes(only);
  const g = await call('GET', appPath, { okStatuses: [404, 403], quiet: false });
  if (g.dry || g.status === 404 || g.status === 403) {
    const app = { name: APP.name, label: APP.label, description: APP.description, version: APP.version, theme: APP.theme, language: APP.language };
    await call('POST', '/sdk/apps', { body: flags.wrap ? { app } : app });
  }
  // 2. general codes
  if (doApp) {
    for (const [k, [section, mime]] of Object.entries(GENERAL)) {
      if (k === 'groups') continue;
      const rel = mf.generalCodeFiles?.[k];
      if (rel) await putCode(appPath + '/' + section, rel, mime);
    }
  }

  // 3. connections
  const connList = firstArray((await call('GET', '/sdk/apps/' + APP.name + '/connections')).data);
  for (const [id, c] of Object.entries(mf.components.connection || {})) {
    if (!want('connection', id)) continue;
    let remote = mapping.connection[id];
    if (remote && !flags.dry && !connList.some(x => x.name === remote)) { console.log('mapped connection ' + remote + ' no longer exists remotely; re-resolving'); remote = null; }
    if (!remote) { // adopt an existing connection with same label+type when unambiguous (e.g. mapping file lost)
      const same = connList.filter(x => x.label === c.label && (!x.type || x.type === c.connectionType) && !Object.values(mapping.connection).includes(x.name));
      if (same.length === 1) { remote = same[0].name; console.log('adopting existing connection ' + remote); }
    }
    if (!remote) {
      const r = await call('POST', '/sdk/apps/' + APP.name + '/connections', { body: { type: c.connectionType || 'basic', label: c.label } });
      remote = r.dry ? null : (r.data?.appConnection?.name || r.data?.name);
      if (!r.dry && !remote) { console.error('cannot read connection name from response: ' + r.text); process.exit(1); }
    }
    if (remote) { mapping.connection[id] = remote; saveMapping(mapping); }
    const rn = remote || ph('connection', id);
    for (const [k, rel] of Object.entries(c.codeFiles || {})) {
      if (!rel) continue;
      const def = SECTIONS.connection[k]; if (!def) { console.log('skip unknown connection code ' + k); continue; }
      await putCode('/sdk/apps/connections/' + rn + '/' + def[0], rel, def[1]);
    }
  }

  // 4. modules
  const modList = firstArray((await call('GET', appPath + '/modules')).data);
  for (const [id, m] of Object.entries(mf.components.module || {})) {
    if (!want('module', id)) continue;
    const remote = mapping.module[id] || camel(id);
    const typeId = TYPE_ID[m.moduleType];
    if (!typeId) throw new Error('unknown moduleType ' + m.moduleType + ' for ' + id);
    const conn = m.connection ? ph('connection', m.connection) : null;
    const exists = modList.some(x => x.name === remote);
    const meta = { label: m.label, description: m.description, connection: conn };
    if (m.moduleType === 'action' && m.actionCrud) meta.crud = m.actionCrud;
    if (!exists) {
      const body = { name: remote, typeId, ...meta, moduleInitMode: 'blank' };
      if (m.moduleType === 'universal') body.subtype = 'Universal';
      await call('POST', appPath + '/modules', { body });
    } else {
      await call('PATCH', appPath + '/modules/' + remote, { body: { ...meta, typeId } });
    }
    mapping.module[id] = remote; saveMapping(mapping);
    for (const [k, rel] of Object.entries(m.codeFiles || {})) {
      if (!rel) continue;
      const def = SECTIONS.module[k]; if (!def) { console.log('skip unknown module code ' + k); continue; }
      await putCode(appPath + '/modules/' + remote + '/' + def[0], rel, def[1]);
    }
  }

  // 5. rpcs
  const rpcList = firstArray((await call('GET', appPath + '/rpcs')).data);
  for (const [id, r] of Object.entries(mf.components.rpc || {})) {
    if (!want('rpc', id)) continue;
    const remote = mapping.rpc[id] || camel(id);
    const conn = r.connection ? ph('connection', r.connection) : null;
    if (!rpcList.some(x => x.name === remote)) await call('POST', appPath + '/rpcs', { body: { name: remote, label: r.label, connection: conn } });
    else await call('PATCH', appPath + '/rpcs/' + remote, { body: { label: r.label, connection: conn } });
    mapping.rpc[id] = remote; saveMapping(mapping);
    for (const [k, rel] of Object.entries(r.codeFiles || {})) {
      if (!rel) continue;
      const def = SECTIONS.rpc[k]; if (!def) { console.log('skip unknown rpc code ' + k); continue; }
      await putCode(appPath + '/rpcs/' + remote + '/' + def[0], rel, def[1]);
    }
  }

  // 6. groups (after modules; module ids translated to remote names)
  if (doApp && mf.generalCodeFiles?.groups) {
    const groups = JSON.parse(fileText(mf.generalCodeFiles.groups));
    for (const grp of groups) grp.modules = (grp.modules || []).map(id => mapping.module[id] || camel(id));
    await call('PUT', appPath + '/groups', { body: JSON.stringify(groups, null, 2), type: 'application/json' });
  }
  console.log(flags.dry ? 'dry run complete (' + n + ' requests planned)' : 'deploy complete (' + n + ' calls). mapping: ' + MAPPING_FILE);
}
main().catch(e => { console.error(e.message); process.exit(1); });
