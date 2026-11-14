import fs from 'node:fs';
import path from 'node:path';

const base = 'packages/shared/src/locales';
const work = path.join(base, '.work');
const en = JSON.parse(fs.readFileSync(path.join(base, 'en.json'), 'utf8'));

const leafKeys = (value, prefix = '') =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) =>
        leafKeys(child, prefix ? `${prefix}.${key}` : key),
      )
    : [prefix];

const placeholders = (value) =>
  [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

const enLeaves = new Map();
for (const key of leafKeys(en)) {
  let value = en;
  for (const part of key.split('.')) value = value[part];
  enLeaves.set(key, value);
}

for (const lang of ['pa', 'ur', 'mr']) {
  const merged = {};
  for (const part of ['a', 'b', 'c', 'd']) {
    const file = path.join(work, `${lang}.${part}.json`);
    const chunk = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(chunk)) {
      if (key in merged) throw new Error(`${lang}: duplicate top-level ${key}`);
      merged[key] = value;
    }
  }
  const mergedKeys = Object.keys(merged);
  const enKeys = Object.keys(en);
  const missingTop = enKeys.filter((key) => !(key in merged));
  const extraTop = mergedKeys.filter((key) => !(key in en));
  if (missingTop.length || extraTop.length) {
    throw new Error(`${lang}: top mismatch missing=${missingTop} extra=${extraTop}`);
  }
  const result = {};
  for (const key of enKeys) result[key] = merged[key];

  const langLeaves = new Map();
  for (const key of leafKeys(result)) {
    let value = result;
    for (const part of key.split('.')) value = value[part];
    langLeaves.set(key, value);
  }
  const missing = [];
  const empty = [];
  const placeholderMismatch = [];
  for (const [key, value] of enLeaves) {
    if (!langLeaves.has(key)) {
      missing.push(key);
      continue;
    }
    const translated = langLeaves.get(key);
    if (typeof translated !== 'string' || !translated.trim()) empty.push(key);
    if (
      JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(translated))
    ) {
      placeholderMismatch.push(key);
    }
  }
  const extra = [...langLeaves.keys()].filter((key) => !enLeaves.has(key));
  console.log(
    `${lang}: leaves=${langLeaves.size} missing=${missing.length} extra=${extra.length} empty=${empty.length} placeholders=${placeholderMismatch.length}`,
  );
  if (missing.length) console.log('  missing sample', missing.slice(0, 12));
  if (empty.length) console.log('  empty sample', empty.slice(0, 12));
  if (placeholderMismatch.length) {
    console.log('  placeholder sample', placeholderMismatch.slice(0, 12));
  }
  if (missing.length || extra.length || empty.length || placeholderMismatch.length) {
    throw new Error(`${lang}: validation failed`);
  }
  fs.writeFileSync(path.join(base, `${lang}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`  wrote ${lang}.json`);
}
