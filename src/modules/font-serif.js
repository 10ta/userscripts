/*
 * Switch "字体替换" to the serif stack on this site (reading sites, novels, blogs).
 * Only takes effect where the font-inject module is on.
 */
register({
  id: 'font-serif',
  name: '字体替换：衬线',
  description: 'Use the serif stack of font-inject on this site.',
  scope: 'site',
  enabledByDefault: false,
  defaultSites: [],   // sites that use the serif stack by default
  run(ctx) {
    ctx.addStyle(':root { --tk-font: var(--tk-font-serif) !important; }');
  },
});
