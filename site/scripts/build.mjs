import './check-node.mjs';
import { copyFile, mkdir } from 'node:fs/promises';
// Set this before importing Vite: the desktop terminal can inherit development mode.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build({ mode: 'production' });

// Static hosts resolve /demo, /customer, /voice and /book only when an entry file exists for the path.
for (const route of ['demo', 'customer', 'voice', 'book']) {
  await mkdir(`dist/${route}`, { recursive: true });
  await copyFile('dist/index.html', `dist/${route}/index.html`);
  await copyFile('dist/index.html', `dist/${route}.html`);
}
