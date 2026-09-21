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
 *     scope:       'site',                   // optional: toggle per website instead of globally
 *     defaultSites: ['example.com'],         // with scope 'site': sites enabled out of the box
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
 * The official site list lives in code (defaultSites), so it is versioned in git
 * and shared by every browser. Menu toggles only record local differences:
 *   sites:<id>:add     sites turned on here that are not in defaultSites
 *   sites:<id>:remove  sites turned off here although defaultSites covers them
 * Effective state = (defaultSites ∪ add) − remove.
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

function isEnabled(mod) {
  if (mod.scope !== 'site') return GM_getValue(storageKey(mod.id), !!mod.enabledByDefault);
  const host = location.hostname;
  const { add, remove } = getLocalDiff(mod);
  if (hostInList(remove, host)) return false;
  return hostInList(mod.defaultSites || [], host) || hostInList(add, host);
}

function toggle(mod) {
  if (mod.scope !== 'site') {
    GM_setValue(storageKey(mod.id), !isEnabled(mod));
    return;
  }
  const host = location.hostname;
  const inDefaults = hostInList(mod.defaultSites || [], host);
  let { add, remove } = getLocalDiff(mod);
  if (isEnabled(mod)) {
    add = add.filter(s => !covers(s, host));
    if (inDefaults) remove = [...remove, host];
  } else {
    remove = remove.filter(s => !covers(s, host));
    if (!inDefaults) add = [...add, host];
  }
  setLocalDiff(mod, { add, remove });
}

// Text ready to paste into the modules' defaultSites arrays.
function exportLocalDiffs() {
  const lines = [];
  for (const mod of MODULES.filter(m => m.scope === 'site')) {
    const { add, remove } = getLocalDiff(mod);
    if (!add.length && !remove.length) continue;
    const quote = list => list.map(s => `'${s}'`).join(', ');
    lines.push(`// ${mod.id} (${mod.name})`);
    if (add.length) lines.push(`// 本地额外开启 -> 加入 defaultSites:`, `${quote(add)},`);
    if (remove.length) lines.push(`// 本地额外关闭 -> 从 defaultSites 删除:`, `${quote(remove)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function clearLocalDiffs() {
  for (const mod of MODULES.filter(m => m.scope === 'site')) setLocalDiff(mod, { add: [], remove: [] });
}

function matchesPage(mod) {
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
  };
}

function runModules() {
  for (const mod of MODULES) {
    if (mod.scope === 'site') migrateSites(mod);
    if (!matchesPage(mod) || !isEnabled(mod)) continue;
    try {
      mod.run(makeContext(mod));
    } catch (err) {
      console.error(`[toolkit:${mod.id}] failed`, err);
    }
  }
}

// Menu: one toggle per module applicable to this page.
// Toggling reloads the page, because most modules act at document-start.
let menuHandles = [];

function buildMenu() {
  for (const h of menuHandles) GM_unregisterMenuCommand(h);
  menuHandles = [];

  for (const mod of MODULES.filter(matchesPage)) {
    const on = isEnabled(mod);
    const label = `${on ? '✅' : '⬜'} ${mod.name}${mod.scope === 'site' ? '（本站）' : ''}`;
    menuHandles.push(
      GM_registerMenuCommand(label, () => {
        toggle(mod);
        location.reload();
      }, { title: mod.description || '' })
    );
  }

  // Local per-site changes: offer export / clear only when there are any.
  const diff = exportLocalDiffs();
  if (diff) {
    menuHandles.push(GM_registerMenuCommand('📋 导出网址限制改动', () => {
      GM_setClipboard(diff, 'text');
      alert(`已复制到剪贴板，整理后写入对应模块的 defaultSites 并 push：\n\n${diff}`);
    }));
    menuHandles.push(GM_registerMenuCommand('🧹 清除网址限制改动', () => {
      if (confirm(`清除后，各网站恢复为代码中 defaultSites 的状态。确定清除？\n\n${diff}`)) {
        clearLocalDiffs();
        location.reload();
      }
    }));
  }
}

function boot() {
  runModules();
  // Menus only make sense in the top frame; skip iframes to avoid duplicates.
  if (window.top === window.self) buildMenu();
}
