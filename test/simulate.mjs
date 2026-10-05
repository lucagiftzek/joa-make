// Simulates the requests Make would build from this app's IML and applies the response directives
// (iterate / output / limit / trigger / pagination / error) to API bodies.
// Offline cases use canned bodies; with JOA_API_KEY set, LIVE=1 also sends a few real requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCode, makecomapp } from './load.mjs';
import { render } from './iml.mjs';

const app = makecomapp();
const base = readCode(app.generalCodeFiles.base);
const moduleCode = (id) => {
  const m = app.components.module[id];
  return { comm: readCode(m.codeFiles.communication), epoch: m.codeFiles.epoch ? readCode(m.codeFiles.epoch) : null };
};
const connMeta = Object.values(app.components.connection)[0];
const connComm = readCode(connMeta.codeFiles.communication);
const NOW = new Date('2026-10-06T12:00:00.000Z');

/** Build the request Make sends: base + module communication, empty query values dropped. */
function buildRequest(comm, ctx, { useBase = true } = {}) {
  const r = render(comm, ctx);
  const b = useBase ? render({ baseUrl: base.baseUrl, headers: base.headers }, ctx) : { headers: {} };
  const url = /^https?:/.test(r.url) ? r.url : `${b.baseUrl}${r.url}`;
  const qs = Object.fromEntries(Object.entries(r.qs || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return { url, method: r.method || 'GET', headers: { ...b.headers, ...(r.headers || {}) }, qs };
}
const urlOf = (req) => `${req.url}${Object.keys(req.qs).length ? `?${new URLSearchParams(req.qs)}` : ''}`;

/** Apply response directives to a body, following pagination via `fetchPage` like Make does. */
async function execute(comm, ctx, fetchPage) {
  const out = [];
  let req = buildRequest(comm, ctx);
  let pages = 0;
  for (;;) {
    const { status, body, headers } = await fetchPage(req);
    const rctx = { ...ctx, body, headers, statusCode: status };
    if (status >= 400) {
      const spec = { ...(base.response.error || {}), ...(base.response.error?.[String(status)] || {}) };
      const err = new Error(render(spec.message, rctx));
      err.type = spec.type;
      throw err;
    }
    const resp = comm.response || {};
    const limit = resp.limit !== undefined ? Number(render(resp.limit, rctx)) : Infinity;
    const items = resp.iterate ? render(resp.iterate, rctx) : [body];
    for (const item of items || []) {
      if (out.length >= limit) return out;
      const ictx = { ...rctx, item };
      out.push({ output: resp.output ? render(resp.output, ictx) : item, trigger: resp.trigger ? render(resp.trigger, ictx) : undefined });
    }
    pages += 1;
    if (!comm.pagination || out.length >= limit || pages >= 20) return out;
    if (!render(comm.pagination.condition, rctx)) return out;
    const next = render({ qs: comm.pagination.qs }, rctx);
    req = { ...req, qs: { ...req.qs, ...next.qs } };
  }
}

const canned = (pages) => {
  const calls = [];
  return { calls, fetchPage: async (req) => { calls.push(req); return pages.shift(); } };
};

test('connection: GET /v1/me with Bearer key; label shows the plan', () => {
  const req = buildRequest(connComm, { parameters: { apiKey: 'test_key' } }, { useBase: false });
  assert.equal(req.url, 'https://api.jobopportunitiesapi.org/v1/me');
  assert.equal(req.headers.Authorization, 'Bearer test_key');
  assert.equal(render(connComm.response.metadata.value, { body: { plan: 'explore' } }), 'explore plan');
});

test('search-jobs: filters become the exact query string, cursor pagination until limit', async () => {
  const { comm } = moduleCode('search-jobs');
  const ctx = {
    connection: { apiKey: 'k' },
    parameters: { q: 'nurse', country: 'de,gb', remote: ['remote', 'hybrid'], employment_type: ['Full-time'], seniority: [], category: ['Healthcare'], include_description: true, posted_after: '2026-10-01T00:00:00.000Z', limit: 3 },
  };
  const { calls, fetchPage } = canned([
    { status: 200, body: { data: [{ id: 'a' }, { id: 'b' }], has_more: true, next_cursor: 'c1' } },
    { status: 200, body: { data: [{ id: 'c' }, { id: 'd' }], has_more: true, next_cursor: 'c2' } },
  ]);
  const out = await execute(comm, ctx, fetchPage);
  assert.deepEqual(out.map((o) => o.output.id), ['a', 'b', 'c']);
  assert.deepEqual(calls[0].qs, { q: 'nurse', country: 'DE,GB', remote: 'remote,hybrid', employment_type: 'Full-time', category: 'Healthcare', posted_after: '2026-10-01T00:00:00Z', include_description: 'true', limit: 3 });
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
  assert.equal(calls[1].qs.cursor, 'c1');
});

test('watch-new-jobs: posted_after from data.lastDate; trigger id/date/order', async () => {
  const { comm, epoch } = moduleCode('watch-new-jobs');
  const first = buildRequest(comm, { connection: {}, parameters: { limit: 10 }, data: {} });
  assert.equal(first.qs.posted_after, undefined);
  const ctx = { connection: {}, parameters: { limit: 10, remote: ['remote'] }, data: { lastDate: '2026-10-05T10:00:00.000Z', lastID: 'x' } };
  const { calls, fetchPage } = canned([{ status: 200, body: { data: [{ id: 'n1', posted_at: '2026-10-05T11:00:00Z', title: 'A' }], has_more: false } }]);
  const out = await execute(comm, ctx, fetchPage);
  assert.equal(calls[0].qs.posted_after, '2026-10-05T10:00:00Z');
  assert.equal(calls[0].qs.remote, 'remote');
  assert.deepEqual(out[0].trigger, { type: 'date', id: 'n1', date: '2026-10-05T11:00:00Z', order: 'desc' });
  const ep = render(epoch.response.output, { item: { posted_at: '2026-10-05T11:00:00Z', title: 'A', company: 'Acme' } });
  assert.deepEqual(ep, { date: '2026-10-05T11:00:00Z', label: 'A — Acme (2026-10-05)' });
});

test('watch-closed-jobs: since rebuilt as "<lastDate>|<lastID>" cursor; next_since pagination', async () => {
  const { comm } = moduleCode('watch-closed-jobs');
  const fresh = buildRequest(comm, { connection: {}, parameters: { limit: 2 }, data: {}, now: NOW });
  assert.equal(fresh.qs.since, '2026-10-06T12:00:00.000Z');
  const ctx = { connection: {}, parameters: { limit: 2 }, data: { lastDate: '2026-10-04T00:51:40.344Z', lastID: '0f35eef0' }, now: NOW };
  const { calls, fetchPage } = canned([
    { status: 200, body: { data: [{ id: 'x', closed_at: '2026-10-04T01:00:00Z' }], next_since: 's1', count: 1 } },
  ]);
  const out = await execute(comm, ctx, fetchPage);
  assert.equal(calls[0].qs.since, '2026-10-04T00:51:40.344Z|0f35eef0');
  assert.equal(calls.length, 1, 'a short page stops pagination');
  assert.deepEqual(out[0].trigger, { type: 'date', id: 'x', date: '2026-10-04T01:00:00Z', order: 'asc' });
});

test('get-job, get-company, universal call and RPC build the right requests', () => {
  const gj = buildRequest(moduleCode('get-job').comm, { connection: {}, parameters: { id: ' my slug ', include_closed: true } });
  assert.equal(urlOf(gj), 'https://api.jobopportunitiesapi.org/v1/jobs/my%20slug?include_closed=true');
  assert.deepEqual(render(moduleCode('get-job').comm.response.output, { body: { data: { id: 'z' }, description: 'Text' } }), { job: { id: 'z' }, description: 'Text' });
  const gc = buildRequest(moduleCode('get-company').comm, { connection: {}, parameters: { slug: 'google' } });
  assert.equal(gc.url, 'https://api.jobopportunitiesapi.org/v1/companies/google');
  const u = buildRequest(moduleCode('make-api-call').comm, { connection: { apiKey: 'k' }, parameters: { url: '/v1/meta/facets', method: 'GET', qs: [{ key: 'limit', value: '5' }], headers: [{ key: 'X-Test', value: '1' }] } });
  assert.equal(urlOf(u), 'https://api.jobopportunitiesapi.org/v1/meta/facets?limit=5');
  assert.equal(u.headers['X-Test'], '1');
  assert.equal(u.headers.Authorization, 'Bearer k');
  const rpc = readCode(app.components.rpc['list-companies'].codeFiles.communication);
  assert.deepEqual(render(rpc.response.output, { item: { slug: 'acme', name: 'Acme' } }), { label: 'Acme', value: 'acme' });
});

test('base error directive maps statuses to clear messages and Make error types', async () => {
  const { comm } = moduleCode('search-jobs');
  const cases = [
    [401, { error: 'invalid_key', message: 'That key is not valid.' }, 'InvalidAccessTokenError', /rejected the API key \(401\).*register.*not valid/],
    [402, { error: 'record_quota_exhausted', message: 'Allowance used.' }, 'RuntimeError', /record allowance.*Allowance used/],
    [403, { error: 'plan_upgrade_required', message: 'Growth needed.' }, 'InvalidConfigurationError', /does not include this endpoint \(403\)/],
    [422, { error: 'bad_remote', message: 'Unknown remote.' }, 'DataError', /rejected a parameter \(422\): Unknown remote/],
    [429, { error: 'rate_limited', message: 'Slow down' }, 'RateLimitError', /rate limit reached \(429\). Retry after 7 seconds/],
    [500, { error: 'boom', message: 'Oops' }, 'RuntimeError', /^\[500\] Oops$/],
  ];
  for (const [status, body, type, re] of cases) {
    const { fetchPage } = canned([{ status, body, headers: { 'retry-after': '7' } }]);
    await assert.rejects(execute(comm, { connection: {}, parameters: { limit: 1 } }, fetchPage), (e) => e.type === type && re.test(e.message));
  }
});

// ---------------------------------------------------------------- live
const KEY = process.env.JOA_API_KEY;
const live = { skip: !(KEY && process.env.LIVE) && 'set LIVE=1 and JOA_API_KEY for live calls' };
const realFetch = async (req) => {
  const res = await fetch(urlOf(req), { method: req.method, headers: req.headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: Object.fromEntries(res.headers) };
};

test('live: connection test returns a plan label; a bad key fails with the mapped message', live, async () => {
  const req = buildRequest(connComm, { parameters: { apiKey: KEY } }, { useBase: false });
  const { status, body } = await realFetch(req);
  assert.equal(status, 200);
  assert.match(render(connComm.response.metadata.value, { body }), / plan$/);
  const { comm } = moduleCode('search-jobs');
  await assert.rejects(execute(comm, { connection: { apiKey: 'joa_invalid_key_for_test' }, parameters: { limit: 1 } }, realFetch), (e) => e.type === 'InvalidAccessTokenError');
});

test('live: search-jobs (pagination past max_page_size) and get-job', live, async () => {
  const { comm } = moduleCode('search-jobs');
  const out = await execute(comm, { connection: { apiKey: KEY }, parameters: { country: 'nl', limit: 3 } }, realFetch);
  assert.equal(out.length, 3);
  assert.ok(out.every((o) => o.output.country === undefined || o.output.country === 'NL'));
  const gj = await execute(moduleCode('get-job').comm, { connection: { apiKey: KEY }, parameters: { id: out[0].output.slug } }, realFetch);
  assert.equal(gj[0].output.job.id, out[0].output.id);
});

test('live: watch-closed-jobs from a cursor 6 hours back; search-companies', live, async () => {
  const lastDate = new Date(Date.now() - 6 * 3600e3).toISOString();
  const out = await execute(moduleCode('watch-closed-jobs').comm, { connection: { apiKey: KEY }, parameters: { limit: 5 }, data: { lastDate }, now: new Date() }, realFetch);
  assert.ok(out.length <= 5);
  for (const o of out) assert.ok(o.trigger.id && o.trigger.date >= lastDate.slice(0, 19));
  const cos = await execute(moduleCode('search-companies').comm, { connection: { apiKey: KEY }, parameters: { q: 'google', limit: 2 } }, realFetch);
  assert.ok(cos.length >= 1);
});
