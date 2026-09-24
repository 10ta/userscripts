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

/*
 * Two module formats live side by side in src/modules:
 *   - Toolkit modules: call register({...}) at top level.
 *   - Plain userscripts: a normal Tampermonkey script with a // ==UserScript==
 *     header and no top-level register(). Dropped in as-is; the build wraps it
 *     into a Toolkit module (menu toggle, @match/@include/@exclude, @run-at,
 *     @require inlined, its own isolated GM_* storage).
 * A file with a header that also calls register() at top level is a Toolkit
 * module (the header is just a comment then).
 */
const HEADER_RE = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/;
const isUserscript = code => HEADER_RE.test(code) && !/^register\s*\(/m.test(code);

function parseMeta(code) {
  const meta = {};
  for (const line of code.match(HEADER_RE)[1].split('\n')) {
    const m = line.match(/^\s*\/\/\s*@([\w:.-]+)(?:\s+(.*?))?\s*$/);
    if (!m) continue;
    (meta[m[1]] ||= []).push(m[2] ?? '');
  }
  return meta;
}

const first = (meta, key) => (meta[key] ? meta[key][0] : undefined);
const slug = file => file.replace(/\.user\.js$|\.js$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// @require: downloaded once at build time and cached; inlined into the module
// so only that module sees the library.
const cacheDir = path.join(root, '.cache/require');
async function fetchRequire(url) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, encodeURIComponent(url));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`@require ${url}: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  return text;
}

// Everything the wrapped scripts need in the combined header.
const extraGrants = new Set();
const extraConnects = new Set();
const extraResources = []; // [prefixedName, url]

async function wrapUserscript(file, code) {
  const meta = parseMeta(code);
  const id = slug(file);
  const grants = (meta.grant || []).filter(g => g && g !== 'none');
  grants.forEach(g => extraGrants.add(g));
  (meta.connect || []).forEach(c => extraConnects.add(c));
  const resources = {};
  for (const r of meta.resource || []) {
    const [name, url] = r.split(/\s+/);
    resources[name] = `${id}--${name}`;
    extraResources.push([`${id}--${name}`, url]);
  }
  const requires = [];
  for (const url of meta.require || []) requires.push(`// @require ${url}\n${await fetchRequire(url)}`);

  const info = {
    id,
    name: first(meta, 'name:zh-CN') || first(meta, 'name:zh') || first(meta, 'name') || id,
    description: first(meta, 'description:zh-CN') || first(meta, 'description:zh') || first(meta, 'description') || '',
    enabledByDefault: first(meta, 'toolkit-default') !== 'off',
    userscript: {
      version: first(meta, 'version') || '',
      namespace: first(meta, 'namespace') || '',
      match: meta.match || [],
      include: meta.include || [],
      exclude: [...(meta.exclude || []), ...(meta['exclude-match'] || [])],
      runAt: first(meta, 'run-at') || 'document-idle',
      noframes: 'noframes' in meta,
      grantNone: grants.length === 0,
      resources,
    },
  };
  // The script body runs inside run(); GM_* names are shadowed by per-module
  // shims (isolated storage, own GM_info, own menu items). Top-level `return`
  // keeps working because the body is a function body, as in a script manager.
  const body = code.replace(HEADER_RE, '');
  return `register(Object.assign(${JSON.stringify(info)}, {
  run(ctx) {
    const { GM, GM_info, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_addElement,
      GM_registerMenuCommand, GM_unregisterMenuCommand, GM_getResourceText, GM_getResourceURL,
      GM_xmlhttpRequest, GM_download, GM_openInTab, GM_setClipboard, GM_notification, GM_log } = ctx.gm;
    const unsafeWindow = ctx.page;
    // Own function: the script may redeclare these names, use top-level return,
    // and runs in sloppy mode like under a script manager.
    (function () {
${requires.join('\n;\n')}
;
${body}
    }).call(window);
  },
}));
`;
}

// Load every module in a sandbox: validates syntax, catches duplicate ids,
// and collects metadata for the README table.
const modules = [];
const sources = {}; // file -> code that goes into the bundle
const userscriptFiles = new Set();
for (const file of moduleFiles) {
  let code = fs.readFileSync(path.join(moduleDir, file), 'utf8');
  try {
    if (isUserscript(code)) {
      code = await wrapUserscript(file, code);
      userscriptFiles.add(file);
    }
    new vm.Script(code, { filename: file }); // syntax check, reported per file
    const sandbox = { register: m => modules.push({ ...m, file }) };
    vm.runInNewContext(code, sandbox, { filename: file });
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
    process.exit(1);
  }
  // A second ==UserScript== block inside the bundle could confuse script
  // managers' header parsing: neutralise leftover header markers.
  sources[file] = code.replace(/==(\/?)UserScript==/g, '[$1userscript header]');
}
const ids = modules.map(m => m.id);
const dup = ids.find((id, i) => ids.indexOf(id) !== i);
if (dup) {
  console.error(`✗ duplicate module id: ${dup}`);
  process.exit(1);
}

// Core's grants plus whatever the wrapped userscripts ask for.
// @match stays *://*/*: core filters by host / URL at runtime.
const grants = [...new Set([
  'GM_addStyle', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_setClipboard',
  'GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_info', 'unsafeWindow',
  ...extraGrants,
])];

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
  ...[...extraConnects].map(c => `// @connect      ${c}`),
  ...extraResources.map(([name, url]) => `// @resource     ${name} ${url}`),
  `// @homepageURL  https://github.com/${repo}`,
  `// @updateURL    ${base}/toolkit.meta.js`,
  `// @downloadURL  ${base}/toolkit.user.js`,
  '// ==/UserScript==',
  '',
].join('\n');

const body = [
  fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'),
  // Each module gets its own function scope, so top-level helpers never clash.
  // Toolkit modules are strict; wrapped userscripts keep their own mode (their
  // text is inserted unchanged, not re-indented, so template strings stay intact).
  ...moduleFiles.map(f => `// ---- module: ${f} ----\n(() => {\n${userscriptFiles.has(f) ? '' : "'use strict';\n"}${sources[f]}\n})();\n`),
  'boot();',
].join('\n');

// No file-wide 'use strict': it would force strict mode on wrapped userscripts.
const script = `${header}\n(function () {\n${body}\n})();\n`;

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
      `| ${m.name} (\`${m.id}\`) | ${m.scope === 'site' ? `按网站（预置 ${(m.defaultSites || []).length} 个）` : (m.enabledByDefault ? '开' : '关')} | ${m.userscript ? [...m.userscript.match, ...m.userscript.include].map(p => `\`${p}\``).join(' ') || '全部' : m.match?.length ? m.match.map(String).join(' ') : '全部'} | ${m.description || ''} |`),
  ].join('\n');
  const readme = fs.readFileSync(readmePath, 'utf8').replace(
    /<!-- modules:start -->[\s\S]*<!-- modules:end -->/,
    `<!-- modules:start -->\n${table}\n<!-- modules:end -->`,
  );
  fs.writeFileSync(readmePath, readme);
}

console.log(`✓ built toolkit ${version} with ${modules.length} module(s): ${ids.join(', ')}`);
