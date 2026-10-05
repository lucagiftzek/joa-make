import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Parse JSON or JSON-with-comments (IMLJSON .iml.jsonc), keeping // inside strings intact. */
export function parseJsonc(text, file = '') {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 1; } else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i === 0) throw new Error(`${file}: unterminated comment`); }
    else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

export const readCode = (rel) => parseJsonc(readFileSync(join(SRC, rel), 'utf8'), rel);
export const makecomapp = () => JSON.parse(readFileSync(join(SRC, 'makecomapp.json'), 'utf8'));
