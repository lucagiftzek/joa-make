// Static validation of the Make custom app source in src/ (local-development layout of the
// official "Make Apps Editor" VS Code extension). Run: node test/validate.mjs
// 1. every file parses (JSON / IMLJSON), 2. makecomapp.json structure and every referenced file exist,
// 3. Make app-review rules that can be checked offline, 4. every IML expression parses and only uses
// functions the evaluator knows, 5. optional: JSON-schema validation against the extension's official
// schemas when test/.schemas/ exists (npm run fetch-schemas).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SRC, readCode, makecomapp, parseJsonc } from './load.mjs';
import { evalExpr, expressions, FUNCTIONS } from './iml.mjs';

const errors = [];
const notes = [];
const fail = (m) => errors.push(m);
const check = (cond, m) => { if (!cond) fail(m); };

// 1. parse every file
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const all = walk(SRC);
for (const f of all.filter((f) => /\.json(c)?$/.test(f))) {
  try { parseJsonc(readFileSync(f, 'utf8'), relative(SRC, f)); } catch (e) { fail(`parse: ${e.message}`); }
}
notes.push(`${all.length} files parsed`);

// 2. makecomapp.json
const app = makecomapp();
for (const k of ['fileVersion', 'generalCodeFiles', 'components', 'origins']) check(k in app, `makecomapp.json: missing ${k}`);
for (const k of ['base', 'common', 'readme', 'groups']) check(k in app.generalCodeFiles, `generalCodeFiles.${k} missing`);
for (const k of ['connection', 'webhook', 'module', 'rpc', 'function', 'endpoint']) check(k in app.components, `components.${k} missing`);
for (const o of app.origins) {
  check(/^https:\/\/(.*)\/api$/.test(o.baseUrl), `origin baseUrl ${o.baseUrl}`);
  check(/^[a-z][0-9a-z-]+[0-9a-z]$/.test(o.appId), `origin appId ${o.appId}`);
  check(typeof o.appVersion === 'number' && o.apikeyFile, 'origin appVersion/apikeyFile');
}
const referenced = new Set();
const ref = (p, what) => {
  if (p === null) return;
  referenced.add(p);
  check(existsSync(join(SRC, p)), `${what}: file ${p} does not exist`);
};
for (const [k, p] of Object.entries(app.generalCodeFiles)) ref(p, `general.${k}`);
for (const [type, comps] of Object.entries(app.components)) {
  for (const [id, meta] of Object.entries(comps)) {
    check(/^[a-z][0-9a-z-]*[0-9a-z]$/.test(id), `${type} id ${id} must be kebab-case`);
    for (const [k, p] of Object.entries(meta.codeFiles || {})) ref(p, `${type}/${id}.${k}`);
  }
}
for (const f of all) {
  const rel = relative(SRC, f).split('\\').join('/');
  if (rel !== 'makecomapp.json' && !referenced.has(rel)) fail(`file not referenced in makecomapp.json: ${rel}`);
}

// 3. review rules
const base = readCode(app.generalCodeFiles.base);
check(base.baseUrl === 'https://api.jobopportunitiesapi.org', 'base.baseUrl');
check(/Bearer \{\{connection\.apiKey\}\}/.test(base.headers?.Authorization || ''), 'base: Authorization header from connection');
check(base.log?.sanitize?.some((s) => /authorization/i.test(s)), 'base: log.sanitize must hide the Authorization header');
for (const s of ['401', '403', '429']) check(base.response?.error?.[s]?.message, `base: error message for ${s}`);
check(base.response?.error?.['429']?.type === 'RateLimitError', 'base: 429 must be RateLimitError');
check(base.response?.error?.['401']?.type === 'InvalidAccessTokenError', 'base: 401 must be InvalidAccessTokenError');

const conns = Object.entries(app.components.connection);
check(conns.length === 1, 'exactly one connection');
for (const [id, meta] of conns) {
  check(meta.connectionType === 'basic', `connection ${id}: basic`);
  const comm = readCode(meta.codeFiles.communication);
  const params = readCode(meta.codeFiles.params);
  check(/\/v1\/me$/.test(comm.url), 'connection validates against /v1/me');
  check(['text', 'email'].includes(comm.response?.metadata?.type), 'connection metadata type text|email');
  check(/plan/.test(comm.response?.metadata?.value || ''), 'connection label shows the plan');
  check(comm.log?.sanitize?.some((s) => /authorization/i.test(s)), 'connection log.sanitize');
  check(params.some((p) => p.name === 'apiKey' && p.type === 'password' && p.required), 'connection apiKey password param');
}

const labels = { trigger: /^Watch /, search: /^(Search|List) /, action: /^(Get|Create|Update|Delete) (a|an) /, universal: /^Make an API Call$/ };
let universal = 0;
for (const [id, meta] of Object.entries(app.components.module)) {
  const where = `module ${id}`;
  check(meta.label && meta.description, `${where}: label and description`);
  check(labels[meta.moduleType]?.test(meta.label), `${where}: label "${meta.label}" does not follow Make naming for ${meta.moduleType}`);
  check(meta.connection === 'joa-api-key', `${where}: connection`);
  const comm = readCode(meta.codeFiles.communication);
  const sp = readCode(meta.codeFiles.staticParams);
  const mp = readCode(meta.codeFiles.mappableParams);
  const iface = readCode(meta.codeFiles.interface);
  const samples = readCode(meta.codeFiles.samples);
  check(Array.isArray(iface) && iface.length > 0, `${where}: interface`);
  check(samples && Object.keys(samples).length > 0, `${where}: samples`);
  const params = [...sp, ...mp];
  for (const p of params) {
    check(p.name && p.type && p.label, `${where}: parameter needs name/type/label (${JSON.stringify(p).slice(0, 60)})`);
    check(p.help, `${where}: parameter ${p.name} needs help`);
  }
  const names = new Set(params.map((p) => p.name));
  for (const e of expressions(comm)) {
    for (const m of e.matchAll(/parameters\.([A-Za-z_]\w*)/g)) check(names.has(m[1]), `${where}: uses parameters.${m[1]} which is not defined`);
  }
  if (meta.moduleType === 'trigger') {
    check(mp.length === 0, `${where}: triggers take static parameters only`);
    check(meta.codeFiles.epoch, `${where}: epoch file`);
    const t = comm.response?.trigger;
    check(t && t.id && t.type && t.order, `${where}: response.trigger needs id, type, order`);
    if (t?.type === 'date') check(t.date, `${where}: trigger.date required for type date`);
    check(comm.response?.limit, `${where}: response.limit`);
    check(names.has('limit'), `${where}: limit parameter`);
    const ep = readCode(meta.codeFiles.epoch);
    check(ep.response?.output?.date && ep.response?.output?.label, `${where}: epoch output needs date and label`);
  }
  if (meta.moduleType === 'search') {
    check(comm.response?.iterate && comm.response?.limit, `${where}: search needs iterate and limit`);
    check(names.has('limit'), `${where}: limit parameter`);
    check(comm.pagination?.condition, `${where}: pagination`);
  }
  if (meta.moduleType === 'action') check(['create', 'read', 'update', 'delete'].includes(meta.actionCrud), `${where}: actionCrud`);
  if (meta.moduleType === 'universal') {
    universal += 1;
    for (const n of ['url', 'method', 'headers', 'qs', 'body']) check(names.has(n), `${where}: universal module param ${n}`);
  }
}
check(universal === 1, 'a universal "Make an API Call" module is required for review');
for (const [id, meta] of Object.entries(app.components.rpc)) {
  const comm = readCode(meta.codeFiles.communication);
  check(comm.response?.output?.label && comm.response?.output?.value, `rpc ${id}: output label/value`);
  check(comm.response?.limit, `rpc ${id}: limit`);
}
const groups = readCode(app.generalCodeFiles.groups);
const grouped = new Set(groups.flatMap((g) => g.modules));
for (const id of Object.keys(app.components.module)) check(grouped.has(id), `module ${id} not in groups.json`);
for (const id of grouped) check(id in app.components.module, `groups.json references unknown module ${id}`);
// rpc:// references resolve
for (const [id, meta] of Object.entries(app.components.module)) {
  for (const p of [...readCode(meta.codeFiles.staticParams), ...readCode(meta.codeFiles.mappableParams)]) {
    if (typeof p.options === 'string' && p.options.startsWith('rpc://')) check(p.options.slice(6) in app.components.rpc, `module ${id}: unknown ${p.options}`);
  }
}

// 4. every IML expression parses; only known functions
let exprCount = 0;
for (const f of all.filter((f) => /\.iml\.json(c)?$/.test(f))) {
  for (const e of expressions(parseJsonc(readFileSync(f, 'utf8')))) {
    exprCount += 1;
    for (const m of e.matchAll(/([A-Za-z_]\w*)\s*\(/g)) check(m[1] in FUNCTIONS, `${relative(SRC, f)}: unknown function ${m[1]}`);
    try { evalExpr(e, { parameters: {}, connection: {}, data: {}, body: {}, headers: {}, item: {} }); } catch (err) {
      if (/parse|tokenize/.test(err.message)) fail(`${relative(SRC, f)}: ${err.message} in {{${e}}}`);
    }
  }
}
notes.push(`${exprCount} IML expressions parsed`);

// 5. no hard numbers about JOA's size in user-facing copy
const copy = all.filter((f) => /README\.md$|params|interface/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
check(!/\b\d+(\.\d+)?\s*(M|K|million|thousand)\+?\s*(jobs|companies|employers|countries)/i.test(copy), 'copy must not state JOA size numbers');

// 6. optional JSON-schema validation with the official extension schemas
const schemaDir = new URL('./.schemas/', import.meta.url);
if (existsSync(schemaDir)) {
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, unicodeRegExp: false });
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(new URL(f, schemaDir), 'utf8'));
    delete s.$schema;
    ajv.addSchema(s, f);
  }
  const v = (schema, data, what) => {
    const ok = ajv.validate(schema, data);
    if (!ok) fail(`schema ${schema} rejects ${what}: ${ajv.errorsText(ajv.errors).slice(0, 400)}`);
    return ok;
  };
  let n = 0;
  v('makecomapp.schema.json', app, 'makecomapp.json'); n += 1;
  v('base.json', base, 'general/base'); n += 1;
  v('groups.json', groups, 'modules/groups.json'); n += 1;
  for (const [, meta] of Object.entries(app.components.connection)) {
    v('api.json', readCode(meta.codeFiles.communication), 'connection communication');
    v('parameters.json', readCode(meta.codeFiles.params), 'connection params'); n += 2;
  }
  for (const [id, meta] of Object.entries(app.components.module)) {
    v('api.json', readCode(meta.codeFiles.communication), `${id} communication`);
    v('parameters.json', readCode(meta.codeFiles.staticParams), `${id} static params`);
    v('parameters.json', readCode(meta.codeFiles.mappableParams), `${id} mappable params`);
    v('parameters.json', readCode(meta.codeFiles.interface), `${id} interface`);
    v('samples.json', readCode(meta.codeFiles.samples), `${id} samples`);
    n += 5;
    if (meta.codeFiles.epoch) { v('epoch.json', readCode(meta.codeFiles.epoch), `${id} epoch`); n += 1; }
  }
  for (const [id, meta] of Object.entries(app.components.rpc)) {
    v('api.json', readCode(meta.codeFiles.communication), `rpc ${id}`);
    v('parameters.json', readCode(meta.codeFiles.params), `rpc ${id} params`); n += 2;
  }
  notes.push(`${n} files validated against the official Make Apps Editor JSON schemas`);
} else {
  notes.push('official schemas not present (run npm run fetch-schemas) — schema step skipped');
}

console.log(notes.map((n) => `- ${n}`).join('\n'));
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n` + errors.map((e) => `  x ${e}`).join('\n'));
  process.exit(1);
}
console.log('validate: OK');
