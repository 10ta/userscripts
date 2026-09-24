/*
 * Core runtime. Modules call register({...}) at load time; after all modules
 * are loaded, boot() runs the enabled ones and builds the Tampermonkey menu.
 *
 * Module shape:
 *   {
 *     id:          'twemoji-everywhere',     // unique, used as storage key
 *     name:        'Twemoji everywhere',     // menu label
 *     description: '...',                    // shown in README / tooltip
 *     enabledByDefault: true,                // optional, default false
 *     match:       [/example\.com$/],        // optional host regexes; default = all sites
 *     parent:      'font-inject',            // optional: list this module indented under another
 *     scope:       'site',                   // optional: toggle per website instead of globally
 *     defaultSites: ['example.com'],         // with scope 'site': exceptions to enabledByDefault
 *                                            //   (default off: sites where ON; default on: sites where OFF)
 *     run(ctx) { ... },                      // runs at document-start when enabled
 *   }
 *
 * ctx helpers: ctx.addStyle(css), ctx.onReady(fn), ctx.log(...args),
 *              ctx.get(key, def), ctx.set(key, value)   (module-scoped storage)
 *              ctx.host                                 (current hostname)
 *              ctx.page    the page's real window (unsafeWindow) for hooking page JS
 *              ctx.expose(fn)  make a function callable from page JS (Firefox needs exportFunction)
 */

const MODULES = [];

function register(mod) {
  if (!mod || !mod.id || typeof mod.run !== 'function') {
    console.error('[toolkit] invalid module', mod);
    return;
  }
  if (MODULES.some(m => m.id === mod.id)) {
    console.error(`[toolkit] duplicate module id: ${mod.id}`);
    return;
  }
  MODULES.push(mod);
}

const storageKey = id => `enabled:${id}`;

/*
 * Per-site modules (scope: 'site').
 *
 * Official state lives in code and is shared by every browser through git:
 *   enabledByDefault: false -> off everywhere, defaultSites lists where it is ON
 *   enabledByDefault: true  -> on everywhere,  defaultSites lists where it is OFF
 * Menu toggles only record local differences on top of that:
 *   sites:<id>:add     sites turned on in this browser
 *   sites:<id>:remove  sites turned off in this browser
 * Local choices win over the official state.
 * "example.com" in any list also covers www.example.com, a.b.example.com, ...
 */
const addKey = id => `sites:${id}:add`;
const removeKey = id => `sites:${id}:remove`;

const covers = (site, host) => host === site || host.endsWith('.' + site);
const hostInList = (list, host) => list.some(s => covers(s, host));

function getLocalDiff(mod) {
  return {
    add: GM_getValue(addKey(mod.id), []),
    remove: GM_getValue(removeKey(mod.id), []),
  };
}

function setLocalDiff(mod, { add, remove }) {
  const save = (key, list) => (list.length ? GM_setValue(key, [...new Set(list)].sort()) : GM_deleteValue(key));
  save(addKey(mod.id), add);
  save(removeKey(mod.id), remove);
}

// Earlier versions stored the whole list under sites:<id>; convert it to a diff once.
function migrateSites(mod) {
  if (mod.enabledByDefault) return; // legacy format only existed for default-off modules
  const legacyKey = `sites:${mod.id}`;
  const legacy = GM_getValue(legacyKey, null);
  if (!Array.isArray(legacy)) return;
  const defaults = mod.defaultSites || [];
  setLocalDiff(mod, {
    add: legacy.filter(s => !defaults.includes(s)),
    remove: defaults.filter(s => !legacy.includes(s)),
  });
  GM_deleteValue(legacyKey);
}

// Official (code) state for a host, before local changes.
function officialState(mod, host) {
  return !!mod.enabledByDefault !== hostInList(mod.defaultSites || [], host);
}

function isEnabled(mod) {
  if (mod.scope !== 'site') return GM_getValue(storageKey(mod.id), !!mod.enabledByDefault);
  const host = location.hostname;
  const { add, remove } = getLocalDiff(mod);
  if (hostInList(remove, host)) return false;
  if (hostInList(add, host)) return true;
  return officialState(mod, host);
}

function toggle(mod) {
  if (mod.scope !== 'site') {
    GM_setValue(storageKey(mod.id), !isEnabled(mod));
    return;
  }
  const host = location.hostname;
  const official = officialState(mod, host);
  let { add, remove } = getLocalDiff(mod);
  // Drop any local entry covering this host, then record one only if the
  // wanted state differs from the official one.
  add = add.filter(s => !covers(s, host));
  remove = remove.filter(s => !covers(s, host));
  const want = !isEnabled(mod);
  if (want !== official) (want ? add : remove).push(host);
  setLocalDiff(mod, { add, remove });
}

// Text ready to paste into the modules' defaultSites arrays.
function exportLocalDiffs(mods) {
  const lines = [];
  for (const mod of mods.filter(m => m.scope === 'site')) {
    const { add, remove } = getLocalDiff(mod);
    if (!add.length && !remove.length) continue;
    const quote = list => list.map(s => `'${s}'`).join(', ');
    lines.push(`// ${mod.id} (${mod.name})，默认${mod.enabledByDefault ? '开启' : '关闭'}`);
    // Default-off: defaultSites = where it's on. Default-on: defaultSites = where it's off.
    const [toList, fromList] = mod.enabledByDefault ? [remove, add] : [add, remove];
    const toLabel = mod.enabledByDefault ? '本地额外关闭' : '本地额外开启';
    const fromLabel = mod.enabledByDefault ? '本地额外开启' : '本地额外关闭';
    if (toList.length) lines.push(`// ${toLabel} -> 加入 defaultSites:`, `${quote(toList)},`);
    if (fromList.length) lines.push(`// ${fromLabel} -> 从 defaultSites 删除:`, `${quote(fromList)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function clearLocalDiffs(mods) {
  for (const mod of mods.filter(m => m.scope === 'site')) setLocalDiff(mod, { add: [], remove: [] });
}

// Userscript URL patterns -> RegExp.
//   @match   scheme://host/path with * wildcards ("*." host prefix = any subdomain)
//   @include glob with *, or /regex/
const escapeRe = str => str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function matchPatternToRe(pattern) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):\/\//;
  const m = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)?$/);
  if (!m) return null;
  const [, scheme, host, pathPart = '/*'] = m;
  const schemeRe = scheme === '*' ? 'https?' : escapeRe(scheme);
  const hostRe = host === '*' ? '[^/]*'
    : host.startsWith('*.') ? `(?:[^/]*\\.)?${escapeRe(host.slice(2))}`
    : escapeRe(host);
  const pathRe = pathPart.split('*').map(escapeRe).join('.*');
  return new RegExp(`^${schemeRe}://${hostRe}(?::\\d+)?${pathRe}$`);
}
function includeToRe(pattern) {
  const re = pattern.match(/^\/(.*)\/([a-z]*)$/);
  if (re) return new RegExp(re[1], re[2]);
  return new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
}

function matchesPage(mod) {
  if (mod.userscript) {
    const url = location.href;
    const us = mod.userscript;
    const hit = list => list.some(re => re && re.test(url));
    us._match ||= us.match.map(matchPatternToRe);
    us._include ||= us.include.map(includeToRe);
    us._exclude ||= us.exclude.map(p => matchPatternToRe(p) || includeToRe(p));
    const included = (us.match.length || us.include.length) ? hit(us._match) || hit(us._include) : true;
    return included && !hit(us._exclude);
  }
  if (!mod.match || mod.match.length === 0) return true;
  const host = location.hostname;
  return mod.match.some(re => re.test(host));
}

const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

function makeContext(mod) {
  const prefix = `[toolkit:${mod.id}]`;
  return {
    host: location.hostname,
    page: PAGE,
    // Firefox isolates userscripts from page JS; functions handed to the page
    // (e.g. patched prototypes) must be exported. Chrome needs nothing.
    expose: fn => (typeof exportFunction === 'function' ? exportFunction(fn, PAGE) : fn),
    addStyle: css => GM_addStyle(css),
    onReady(fn) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else {
        fn();
      }
    },
    log: (...args) => console.log(prefix, ...args),
    get: (key, def) => GM_getValue(`data:${mod.id}:${key}`, def),
    set: (key, value) => GM_setValue(`data:${mod.id}:${key}`, value),
    gm: mod.userscript ? makeGM(mod) : null,
  };
}

// GM_* API for a wrapped userscript: its own storage namespace, its own
// GM_info and resources, menu items shown under its toggle; the rest passes
// through to the script manager (undefined when the manager lacks it).
function makeGM(mod) {
  // Script managers expose GM_* as variables in the script's scope, not as
  // window properties, so each one is referenced by name here.
  const managerApi = {
    GM_listValues: typeof GM_listValues === 'function' ? GM_listValues : undefined,
    GM_getResourceText: typeof GM_getResourceText === 'function' ? GM_getResourceText : undefined,
    GM_getResourceURL: typeof GM_getResourceURL === 'function' ? GM_getResourceURL : undefined,
    GM_addElement: typeof GM_addElement === 'function' ? GM_addElement : undefined,
    GM_xmlhttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : undefined,
    GM_download: typeof GM_download === 'function' ? GM_download : undefined,
    GM_openInTab: typeof GM_openInTab === 'function' ? GM_openInTab : undefined,
    GM_setClipboard: typeof GM_setClipboard === 'function' ? GM_setClipboard : undefined,
    GM_notification: typeof GM_notification === 'function' ? GM_notification : undefined,
    GM_log: typeof GM_log === 'function' ? GM_log : undefined,
  };
  const has = name => typeof managerApi[name] === 'function';
  const pass = name => managerApi[name];
  const key = k => `us:${mod.id}:${k}`;
  const us = mod.userscript;
  const resource = name => us.resources[name] || name;

  const api = {
    GM_getValue: (k, d) => GM_getValue(key(k), d),
    GM_setValue: (k, v) => GM_setValue(key(k), v),
    GM_deleteValue: k => GM_deleteValue(key(k)),
    GM_listValues: () => (has('GM_listValues') ? managerApi.GM_listValues() : [])
      .filter(k => k.startsWith(key(''))).map(k => k.slice(key('').length)),
    GM_registerMenuCommand: (label, fn, opts) => GM_registerMenuCommand(`${CHILD}${label}`, fn, opts),
    GM_unregisterMenuCommand: id => GM_unregisterMenuCommand(id),
    GM_getResourceText: name => has('GM_getResourceText') ? managerApi.GM_getResourceText(resource(name)) : undefined,
    GM_getResourceURL: name => has('GM_getResourceURL') ? managerApi.GM_getResourceURL(resource(name)) : undefined,
    GM_addStyle: css => GM_addStyle(css),
    GM_info: {
      ...(typeof GM_info === 'object' ? GM_info : {}),
      script: { name: mod.name, description: mod.description, version: us.version, namespace: us.namespace },
    },
  };
  for (const name of ['GM_addElement', 'GM_xmlhttpRequest', 'GM_download', 'GM_openInTab',
    'GM_setClipboard', 'GM_notification', 'GM_log']) api[name] = pass(name);

  // Promise-based GM.* API (Greasemonkey 4 style).
  const wrap = fn => (fn ? (...args) => Promise.resolve(fn(...args)) : undefined);
  api.GM = {
    info: api.GM_info,
    getValue: wrap(api.GM_getValue), setValue: wrap(api.GM_setValue),
    deleteValue: wrap(api.GM_deleteValue), listValues: wrap(api.GM_listValues),
    registerMenuCommand: wrap(api.GM_registerMenuCommand),
    getResourceText: wrap(api.GM_getResourceText), getResourceUrl: wrap(api.GM_getResourceURL),
    addStyle: wrap(api.GM_addStyle), addElement: wrap(api.GM_addElement),
    xmlHttpRequest: api.GM_xmlhttpRequest, download: api.GM_download,
    openInTab: api.GM_openInTab, setClipboard: wrap(api.GM_setClipboard),
    notification: api.GM_notification, log: api.GM_log,
  };
  return api;
}

// @run-at for wrapped userscripts; Toolkit modules always start at document-start.
function whenRunAt(runAt, fn) {
  const ready = () => document.readyState !== 'loading';
  switch (runAt) {
    case 'document-start':
      return fn();
    case 'document-body':
      if (document.body) return fn();
      return new MutationObserver((_, obs) => {
        if (document.body) { obs.disconnect(); fn(); }
      }).observe(document.documentElement, { childList: true });
    case 'document-end':
      if (ready()) return fn();
      return document.addEventListener('DOMContentLoaded', fn, { once: true });
    default: // document-idle: after DOMContentLoaded, once the page had a moment
      if (ready()) return setTimeout(fn, 0);
      return document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 0), { once: true });
  }
}

function runModules() {
  const inFrame = window.top !== window.self;
  for (const mod of MODULES) {
    if (mod.scope === 'site') migrateSites(mod);
    if (!matchesPage(mod) || !isEnabled(mod)) continue;
    if (mod.userscript && mod.userscript.noframes && inFrame) continue;
    const start = () => {
      try {
        mod.run(makeContext(mod));
      } catch (err) {
        console.error(`[toolkit:${mod.id}] failed`, err);
      }
    };
    whenRunAt(mod.userscript ? mod.userscript.runAt : 'document-start', start);
  }
}

// Menu: one toggle per module applicable to this page.
// Toggling reloads the page, because most modules act at document-start.
let menuHandles = [];

// Userscript menus are flat, so child items are drawn with a "└" prefix.
const CHILD = '└ ';

function buildMenu() {
  for (const h of menuHandles) GM_unregisterMenuCommand(h);
  menuHandles = [];
  // Script managers treat commands with the same caption as one command: a later
  // registration silently replaces the earlier one (e.g. the second "导出本地改动").
  // Keep every caption unique with invisible zero-width spaces, and pass a unique id.
  let seq = 0;
  const add = (label, fn, title) => {
    seq += 1;
    menuHandles.push(GM_registerMenuCommand(label + '\u200B'.repeat(seq), fn, { id: `toolkit-${seq}`, title: title || '' }));
  };

  const visible = MODULES.filter(matchesPage);
  // A module with `parent: '<id>'` is listed (indented) right under that module.
  for (const mod of visible.filter(m => !m.parent || !visible.some(p => p.id === m.parent))) {
    const group = [mod, ...visible.filter(m => m.parent === mod.id)];

    group.forEach((m, i) => {
      const label = `${i ? CHILD : ''}${isEnabled(m) ? '✅' : '⬜'} ${m.name}${m.scope === 'site' ? '（本站）' : ''}`;
      add(label, () => { toggle(m); location.reload(); }, m.description);
    });

    // Per-site groups always offer export / clear of their local changes.
    if (!group.some(m => m.scope === 'site')) continue;
    add(`${CHILD}📋 导出本地改动`, () => {
      const diff = exportLocalDiffs(group);
      if (!diff) return alert('没有本地改动。');
      GM_setClipboard(diff, 'text');
      alert(`已复制到剪贴板，整理后写入对应模块的 defaultSites 并 push：\n\n${diff}`);
    });
    add(`${CHILD}🧹 清除本地改动`, () => {
      const diff = exportLocalDiffs(group);
      if (!diff) return alert('没有本地改动。');
      if (confirm(`清除后，这些网站恢复为代码中 defaultSites 的状态。确定清除？\n\n${diff}`)) {
        clearLocalDiffs(group);
        location.reload();
      }
    });
  }
}

function boot() {
  runModules();
  // Menus only make sense in the top frame; skip iframes to avoid duplicates.
  if (window.top === window.self) buildMenu();
}