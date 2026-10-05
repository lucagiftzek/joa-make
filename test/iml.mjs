// A small IML (Make's template language) evaluator covering the expressions this app uses.
// It lets the tests build the exact HTTP requests Make would send and apply the response directives.
// Not a full IML implementation: unknown functions throw, so the tests notice anything unsupported.

const pad = (n, w = 2) => String(n).padStart(w, '0');

function formatDate(value, fmt, tz) {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  if (tz && tz !== 'UTC') throw new Error(`formatDate: only UTC supported in tests, got ${tz}`);
  const parts = {
    YYYY: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), DD: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()), SSS: pad(d.getUTCMilliseconds(), 3),
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|SSS|MM|DD|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : String(parts[m])));
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export const FUNCTIONS = {
  join: (arr, sep) => (Array.isArray(arr) ? arr.join(sep) : arr === undefined ? '' : String(arr)),
  upper: (s) => (s === undefined || s === null ? s : String(s).toUpperCase()),
  trim: (s) => (s === undefined || s === null ? s : String(s).trim()),
  ifempty: (a, b) => (isEmpty(a) ? b : a),
  if: (c, a, b) => (c && !isEmpty(c) ? a : b),
  formatDate,
  addDays: (d, n) => new Date(new Date(d).getTime() + Number(n) * 86400000),
  encodeURL: (s) => encodeURIComponent(s ?? ''),
  length: (v) => (v === undefined || v === null ? 0 : v.length),
  toCollection: (arr, k, v) => Object.fromEntries((arr || []).map((x) => [x[k], x[v]])),
};

function tokenize(src) {
  const re = /\s*(?:(-?\d+(?:\.\d+)?)|'((?:[^'\\]|\\.)*)'|(>=|<=|==|!=|[(),.><\[\]])|(`[^`]*`|[A-Za-z_$][\w$-]*))/y;
  const out = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    if (/^\s*$/.test(src.slice(start))) break;
    m = re.exec(src);
    if (!m) throw new Error(`IML tokenize error at "${src.slice(start)}"`);
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].replace(/\\'/g, "'") });
    else if (m[3] !== undefined) out.push({ t: 'op', v: m[3] });
    else out.push({ t: 'id', v: m[4].replace(/^`|`$/g, '') });
  }
  return out;
}

function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = (v) => {
    const t = tokens[i];
    if (!t || (v && t.v !== v)) throw new Error(`IML parse error: expected ${v} got ${t && t.v}`);
    i += 1;
    return t;
  };
  function primary() {
    const t = eat();
    if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.t !== 'id') throw new Error(`IML parse error near ${t.v}`);
    if (peek() && peek().v === '(') {
      eat('(');
      const args = [];
      if (peek().v !== ')') { args.push(expr()); while (peek().v === ',') { eat(','); args.push(expr()); } }
      eat(')');
      return { k: 'call', name: t.v, args };
    }
    const path = [t.v];
    while (peek() && (peek().v === '.' || peek().v === '[')) {
      if (eat().v === '.') path.push(eat().v);
      else { path.push(eat().v); eat(']'); }
    }
    return { k: 'path', path };
  }
  function expr() {
    let left = primary();
    while (peek() && ['>=', '<=', '==', '!=', '>', '<'].includes(peek().v)) {
      const op = eat().v;
      left = { k: 'cmp', op, left, right: primary() };
    }
    return left;
  }
  const e = expr();
  if (i !== tokens.length) throw new Error('IML parse error: trailing tokens');
  return e;
}

function evalNode(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'path': {
      if (n.path.length === 1 && n.path[0] === 'now') return ctx.now ?? new Date();
      if (n.path.length === 1 && ['true', 'false', 'null', 'undefined'].includes(n.path[0])) {
        return { true: true, false: false, null: null, undefined }[n.path[0]];
      }
      return n.path.reduce((acc, k) => (acc === undefined || acc === null ? undefined : acc[k]), ctx);
    }
    case 'call': {
      const f = FUNCTIONS[n.name];
      if (!f) throw new Error(`IML function not supported by the test evaluator: ${n.name}`);
      return f(...n.args.map((a) => evalNode(a, ctx)));
    }
    case 'cmp': {
      const a = evalNode(n.left, ctx); const b = evalNode(n.right, ctx);
      return { '>=': a >= b, '<=': a <= b, '==': a == b, '!=': a != b, '>': a > b, '<': a < b }[n.op]; // eslint-disable-line eqeqeq
    }
    default: throw new Error('bad node');
  }
}

export const evalExpr = (src, ctx) => evalNode(parse(tokenize(src)), ctx);

/** Render an IML template value (string, object or array) against a context. */
export function render(value, ctx) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([\s\S]*)\}\}$/);
    if (whole && !whole[1].includes('}}')) return evalExpr(whole[1], ctx);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
      const v = evalExpr(e, ctx);
      if (v === undefined || v === null) return '';
      if (v instanceof Date) return v.toISOString();
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '{{...}}') Object.assign(out, render(v, ctx));
      else out[render(k, ctx)] = render(v, ctx);
    }
    return out;
  }
  return value;
}

/** Collect every IML expression in a code file (for static checks). */
export function expressions(value, out = []) {
  if (typeof value === 'string') for (const m of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) { if (m[1] !== '...') out.push(m[1]); }
  else if (Array.isArray(value)) value.forEach((v) => expressions(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { expressions(k, out); expressions(v, out); }
  return out;
}
