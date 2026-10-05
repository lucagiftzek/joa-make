// Downloads the JSON schemas that the official "Make Apps Editor" VS Code extension
// (github.com/integromat/vscode-apps-sdk) uses to validate IMLJSON files, into test/.schemas/.
// They are not vendored (no licence file in that repository); test/validate.mjs uses them when present.
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/integromat/vscode-apps-sdk/master/syntaxes';
const files = ['api', 'api-oauth', 'base', 'common', 'epoch', 'enums', 'groups', 'parameters', 'response', 'samples', 'scope', 'scopes', 'sources']
  .map((f) => [`${BASE}/imljson/schemas/${f}.json`, `${f}.json`])
  .concat([[`${BASE}/local-development/schemas/makecomapp.schema.json`, 'makecomapp.schema.json']]);
const dir = new URL('../test/.schemas/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [url, name] of files) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(new URL(name, dir), await res.text());
}
console.log(`${files.length} schemas saved to test/.schemas/`);
