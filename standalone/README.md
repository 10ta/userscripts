# standalone

Independent userscripts, **not** bundled into Toolkit. Each `*.user.js` here is
published as its own Release asset and installed separately in Tampermonkey,
so it runs in its own native environment (own `@grant`, `@run-at`, sandbox)
with Tampermonkey's own per-script on/off switch.

The build sets `@updateURL` / `@downloadURL` to this repo's latest Release, so
installed copies update from here. Bump `@version` when you change a script,
otherwise Tampermonkey won't pick up the update.
