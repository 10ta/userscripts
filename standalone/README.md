# standalone

Independent userscripts, **not** bundled into Toolkit. Each `*.user.js` here is
published as its own Release asset and installed separately in Tampermonkey,
so it runs in its own native environment (own `@grant`, `@run-at`, sandbox)
with Tampermonkey's own per-script on/off switch.

File names must end in `.user.js` (anything else is ignored by the build) and
should avoid `+` and other special characters, since they end up in the URL.

The build sets `@updateURL` (a small `.meta.js` header file) and `@downloadURL`
to this repo's latest Release, and appends the time of the file's last commit
to `@version` (e.g. `0.6.4` → `0.6.4.202610132101`). Every pushed change is
therefore a new, higher version and installed copies update automatically —
no manual bump needed. Raising the script's own `@version` is still fine.
