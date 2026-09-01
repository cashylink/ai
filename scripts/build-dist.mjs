import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const files = [
  'index.html',
  'login.html',
  'signup.html',
  'desktop-auth-success.html',
  'workspace.html',
  'firestore.rules',
  'README.md',
  'favicon.svg',
  'favicon.png',
  'favicon.ico',
];

const dirs = ['css', 'js'];

if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
}
mkdirSync(dist, { recursive: true });

for (const file of files) {
  cpSync(join(root, file), join(dist, file));
}

for (const dir of dirs) {
  cpSync(join(root, dir), join(dist, dir), { recursive: true });
}

console.log('[LOQUIRA] dist ready:', dist);
console.log('[LOQUIRA] Upload the dist/ folder to your static host.');
