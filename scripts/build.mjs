// Build dist/toolkit.user.js (+ .meta.js for update checks) from src/.
// Zero dependencies: modules are plain files concatenated after core.js.
//
// Env:
//   VERSION            userscript @version (CI passes one; default 0.0.0 for local builds)
//   GITHUB_REPOSITORY  owner/repo used for update URLs (CI sets it automatically)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const meta = pkg.userscript;

const version = process.env.VERSION || '0.0.0';
const repo = process.env.GITHUB_REPOSITORY || meta.repository;
const base = `https://github.com/${repo}/releases/latest/download`;

const moduleDir = path.join(root, 'src/modules');
const moduleFiles = fs.readdirSync(moduleDir)
  .filter(f => f.endsWith('.js') && !f.startsWith('_'))
  .sort();

// Load every module in a sandbox: validates syntax, catches duplicate ids,
// and collects metadata for the README table.
const modules = [];
for (const file of moduleFiles) {
  const code = fs.readFileSync(path.join(moduleDir, file), 'utf8');
  const sandbox = { register: m => modules.push({ ...m, file }) };
  try {
    vm.runInNewContext(code, sandbox, { filename: file });
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
    process.exit(1);
  }
}
const ids = modules.map(m => m.id);
const dup = ids.find((id, i) => ids.indexOf(id) !== i);
if (dup) {
  console.error(`✗ duplicate module id: ${dup}`);
  process.exit(1);
}

// Aggregate @match from modules is not needed: core filters by host at runtime.
const grants = [
  'GM_addStyle', 'GM_getValue', 'GM_setValue',
  'GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'unsafeWindow',
];

const header = [
  '// ==UserScript==',
  `// @name         ${meta.name}`,
  `// @namespace    ${meta.namespace}`,
  `// @version      ${version}`,
  `// @description  ${pkg.description}`,
  `// @author       ${meta.author}`,
  '// @match        *://*/*',
  '// @run-at       document-start',
  // Inject into the page context when possible, so modules can hook page JS.
  '// @sandbox      JavaScript',
  ...grants.map(g => `// @grant        ${g}`),
  `// @homepageURL  https://github.com/${repo}`,
  `// @updateURL    ${base}/toolkit.meta.js`,
  `// @downloadURL  ${base}/toolkit.user.js`,
  '// ==/UserScript==',
  '',
].join('\n');

const indent = s => s.replace(/^(?=.)/gm, '  ');
const body = [
  fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'),
  // Each module gets its own function scope, so top-level helpers never clash.
  ...moduleFiles.map(f => `// ---- module: ${f} ----\n(() => {\n${indent(fs.readFileSync(path.join(moduleDir, f), 'utf8'))}})();\n`),
  'boot();',
].join('\n');

const script = `${header}\n(function () {\n  'use strict';\n\n${indent(body)}})();\n`;

// Final syntax check of the assembled file.
try {
  new vm.Script(script, { filename: 'toolkit.user.js' });
} catch (err) {
  console.error(`✗ assembled script has a syntax error: ${err.message}`);
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/toolkit.user.js'), script);
fs.writeFileSync(path.join(root, 'dist/toolkit.meta.js'), header);

// Refresh the module table in README between the markers.
const readmePath = path.join(root, 'README.md');
if (fs.existsSync(readmePath)) {
  const table = [
    '| 模块 | 默认 | 作用站点 | 说明 |',
    '|---|---|---|---|',
    ...modules.map(m =>
      `| ${m.name} (\`${m.id}\`) | ${m.scope === 'site' ? `按网站（预置 ${(m.defaultSites || []).length} 个）` : (m.enabledByDefault ? '开' : '关')} | ${m.match?.length ? m.match.map(String).join(' ') : '全部'} | ${m.description || ''} |`),
  ].join('\n');
  const readme = fs.readFileSync(readmePath, 'utf8').replace(
    /<!-- modules:start -->[\s\S]*<!-- modules:end -->/,
    `<!-- modules:start -->\n${table}\n<!-- modules:end -->`,
  );
  fs.writeFileSync(readmePath, readme);
}

console.log(`✓ built toolkit ${version} with ${modules.length} module(s): ${ids.join(', ')}`);
