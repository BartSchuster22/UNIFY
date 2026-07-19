import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['apps', 'packages'];
const violations = [];
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(item.name)) continue;
    const full = join(path, item.name);
    if (item.isDirectory()) await walk(full);
    else if (/\.(?:ts|tsx|mts)$/.test(item.name)) {
      const text = await readFile(full, 'utf8');
      if (/from ['"](?:\.\.\/){3,}/.test(text)) violations.push(full);
    }
  }
}
for (const root of roots) await walk(root);
if (violations.length) {
  console.error('Cross-workspace relative imports are forbidden:', violations);
  process.exit(1);
}
console.log('Workspace boundary check passed');
