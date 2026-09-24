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