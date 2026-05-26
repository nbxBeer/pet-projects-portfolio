/**
 * i18n Audit Script
 * Usage: node scripts/i18n-audit.mjs
 *
 * Reports:
 *   1. Keys in en.js missing from ru.js
 *   2. Keys in ru.js missing from en.js
 *   3. Hardcoded Cyrillic text in frontend/src components (not via t())
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ── Load a locale file (export default {...}) via new Function ───────────────

function loadLang(file) {
  const src = readFileSync(file, 'utf8')
    .replace(/^export\s+default\s+/, 'return ');
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

// ── Flatten nested object to dot-key paths ───────────────────────────────────

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ── Walk source files recursively ────────────────────────────────────────────

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(full)) {
      files.push(full);
    }
  }
  return files;
}

// ── Detect hardcoded Cyrillic lines ──────────────────────────────────────────

const CYRILLIC_RE = /[Ѐ-ӿ]/;

function findCyrillicLines(file) {
  const hits = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const noInlineComment = raw.replace(/\/\/.*$/, '');
    if (CYRILLIC_RE.test(noInlineComment)) {
      hits.push({ line: i + 1, text: raw.trim() });
    }
  }
  return hits;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const en = flatten(loadLang(join(ROOT, 'frontend/src/i18n/en.js')));
const ru = flatten(loadLang(join(ROOT, 'frontend/src/i18n/ru.js')));

const enKeys = new Set(Object.keys(en));
const ruKeys = new Set(Object.keys(ru));

const missingInRu = [...enKeys].filter(k => !ruKeys.has(k)).sort();
const missingInEn = [...ruKeys].filter(k => !enKeys.has(k)).sort();

const HR = '═'.repeat(65);
const hr = '─'.repeat(65);

console.log(`\n${HR}`);
console.log(' i18n AUDIT REPORT');
console.log(`${HR}\n`);

if (missingInRu.length === 0) {
  console.log('✅  All EN keys present in RU\n');
} else {
  console.log(`❌  Keys in EN missing from RU  (${missingInRu.length}):`);
  missingInRu.forEach(k => console.log(`     ${k}`));
  console.log('');
}

if (missingInEn.length === 0) {
  console.log('✅  All RU keys present in EN\n');
} else {
  console.log(`❌  Keys in RU missing from EN  (${missingInEn.length}):`);
  missingInEn.forEach(k => console.log(`     ${k}`));
  console.log('');
}

console.log(`${hr}`);
console.log(' Hardcoded Cyrillic in frontend/src/  (excluding i18n/ and assets/)');
console.log(`${hr}\n`);

const srcDir = join(ROOT, 'frontend/src');
const sourceFiles = walkFiles(srcDir).filter(
  f => !f.includes(`${join(srcDir, 'i18n')}`) && !f.includes(`${join(srcDir, 'assets')}`)
);

let cyrTotal = 0;
for (const file of sourceFiles) {
  const hits = findCyrillicLines(file);
  if (hits.length > 0) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    console.log(`📄  ${rel}`);
    for (const h of hits) {
      console.log(`     L${h.line}: ${h.text}`);
    }
    console.log('');
    cyrTotal += hits.length;
  }
}

if (cyrTotal === 0) console.log('✅  No hardcoded Cyrillic found\n');

console.log(`${HR}`);
console.log(` SUMMARY`);
console.log(`   Missing RU keys : ${missingInRu.length}`);
console.log(`   Missing EN keys : ${missingInEn.length}`);
console.log(`   Cyrillic lines  : ${cyrTotal}`);
console.log(`${HR}\n`);
