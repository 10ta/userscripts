/*
 * Switch "字体替换" to the serif stack on this site (reading sites, novels, blogs).
 * Only takes effect where the font-inject module is on.
 */
register({
  id: 'font-serif',
  name: '改用衬线字体',
  parent: 'font-inject',
  description: 'Use the serif stack of font-inject on this site.',
  scope: 'site',
  enabledByDefault: false,
  defaultSites: [],   // sites that use the serif stack by default
  run(ctx) {
    ctx.addStyle(':root { --tk-font: var(--tk-font-serif) !important; }');
  },
});
