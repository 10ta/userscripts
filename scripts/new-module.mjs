// Scaffold a new module: npm run new -- my-feature "显示名称"
import fs from 'node:fs';
import path from 'node:path';

const [id, name = id] = process.argv.slice(2);
if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error('Usage: npm run new -- <id-in-kebab-case> ["显示名称"]');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = path.join(root, 'src/modules', `${id}.js`);
if (fs.existsSync(file)) {
  console.error(`Already exists: ${file}`);
  process.exit(1);
}
fs.writeFileSync(file, `register({
  id: '${id}',
  name: '${name.replace(/'/g, "\\'")}',
  description: '',
  enabledByDefault: false,
  // match: [/(^|\\.)example\\.com$/],   // limit to some hosts; omit for all sites
  run(ctx) {
    // Runs at document-start. Use ctx.onReady(() => { ... }) for DOM work.
    // ctx.addStyle(css) / ctx.get(key, def) / ctx.set(key, value) / ctx.log(...)
  },
});
`);
console.log(`Created src/modules/${id}.js`);
