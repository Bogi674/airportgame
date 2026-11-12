#!/usr/bin/env node
// Mechanical checks for the hard rules in CLAUDE.md that eslint does not cover.
// Usage: node scripts/rules-check.mjs [--all] [files...]
// With no files it checks every file changed against origin/main plus untracked files.
// Exit code 1 when a rule is broken, with one line per finding: file:line rule text.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const all = args.includes('--all');
let files = args.filter((a) => !a.startsWith('--'));

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

if (files.length === 0) {
  if (all) files = sh('git ls-files').split('\n');
  else {
    const base = sh('git merge-base HEAD origin/main').trim() || 'HEAD';
    files = [...sh(`git diff --name-only ${base}`).split('\n'), ...sh('git ls-files --others --exclude-standard').split('\n')];
  }
}
files = [...new Set(files.filter((f) => f && existsSync(f)))];

const TEXT = /\.(ts|tsx|md|json|mjs|cjs|css|html)$/;
const SKIP = [/^node_modules\//, /^dist/, /^docs\/reference\//, /^docs\/art\//, /package-lock\.json$/, /^src\/data\/aircraft\/aircraft\.mvp\.json$/, /^scripts\/rules-check\.mjs$/];
const findings = [];
const add = (file, line, rule, text) => findings.push(`${file}:${line} ${rule}: ${text.trim().slice(0, 120)}`);

for (const file of files) {
  if (!TEXT.test(file) || SKIP.some((r) => r.test(file))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const isMd = file.endsWith('.md');
  const isCode = /\.(ts|tsx|mjs|cjs)$/.test(file);
  const inSim = file.startsWith('src/sim/');
  let fence = false;
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (isMd && raw.trimStart().startsWith('```')) {
      fence = !fence;
      return;
    }
    // Rule 15: no em dashes and no en dashes anywhere in text we write.
    if (/[\u2014\u2013]/.test(raw)) add(file, n, 'dash', raw);
    // Rule 15: no spaced hyphen used as a sentence connector in prose.
    let prose = null;
    if (isMd && !fence) prose = raw.replace(/^\s*[-*+]\s+/, '').replace(/`[^`]*`/g, '');
    else if (isCode) {
      const c = raw.match(/^\s*(\/\/|\/\*\*?|\*)\s?(.*)$/);
      if (c) prose = c[2].replace(/`[^`]*`/g, '');
    } else if (file.endsWith('.json') && file.includes('strings')) prose = raw;
    // Math such as `r - h` or `(a - b) * c` is fine: flag only a hyphen between two real words in prose.
    if (prose !== null && !/^\|/.test(prose.trim()) && !/[=*/+<>]/.test(prose) && /[A-Za-z]{3,}[,.)]? - [A-Za-z(]{3,}/.test(prose)) add(file, n, 'spaced-hyphen', raw);
    if (!isCode) return;
    // Definition of done: no any, no TODO without a roadmap entry.
    if (/(:\s*any\b|\bas any\b|<any>|any\[\])/.test(raw)) add(file, n, 'any', raw);
    if (/\b(TODO|FIXME|XXX)\b/.test(raw) && !/ROADMAP|M\d+/.test(raw)) add(file, n, 'todo', raw);
    if (!inSim) return;
    // Rule 2: determinism inside the sim.
    if (/\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bnew Date\(/.test(raw)) add(file, n, 'determinism', raw);
    if (/\bMath\.(sin|cos|tan|atan2|asin|acos)\(/.test(raw)) add(file, n, 'trig-lut', raw);
    // Rule 1: the sim imports only shared and data.
    const imp = raw.match(/from ['"]([^'"]+)['"]/);
    if (imp && /^(@render|@ui|@worker)|\/(render|ui|worker)\//.test(imp[1])) add(file, n, 'sim-import', raw);
    if (/\b(document|window|HTMLCanvasElement|OffscreenCanvas|requestAnimationFrame)\b/.test(raw) && !/^\s*(\/\/|\*)/.test(raw)) add(file, n, 'sim-dom', raw);
  });
}

if (findings.length > 0) {
  console.log(findings.join('\n'));
  console.log(`\nrules-check: ${findings.length} finding(s). Fix them; see the hard rules in CLAUDE.md.`);
  process.exit(1);
}
console.log(`rules-check: ${files.length} file(s) checked, no findings.`);
