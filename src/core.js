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
 *     run(ctx) { ... },                      // runs at document-start when enabled
 *   }
 *
 * ctx helpers: ctx.addStyle(css), ctx.onReady(fn), ctx.log(...args),
 *              ctx.get(key, def), ctx.set(key, value)   (module-scoped storage)
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

function isEnabled(mod) {
  return GM_getValue(storageKey(mod.id), !!mod.enabledByDefault);
}

function matchesPage(mod) {
  if (!mod.match || mod.match.length === 0) return true;
  const host = location.hostname;
  return mod.match.some(re => re.test(host));
}

function makeContext(mod) {
  const prefix = `[toolkit:${mod.id}]`;
  return {
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
    const label = `${on ? '✅' : '⬜'} ${mod.name}`;
    menuHandles.push(
      GM_registerMenuCommand(label, () => {
        GM_setValue(storageKey(mod.id), !on);
        location.reload();
      }, { title: mod.description || '' })
    );
  }
}

function boot() {
  runModules();
  // Menus only make sense in the top frame; skip iframes to avoid duplicates.
  if (window.top === window.self) buildMenu();
}
