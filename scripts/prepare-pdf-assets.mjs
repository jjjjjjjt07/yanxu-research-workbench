import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('public/pdf-assets');
mkdirSync(root, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm'])
  cpSync(resolve('node_modules/pdfjs-dist', dir), resolve(root, dir), {
    recursive: true,
  });
console.log('PDF character maps, fonts and WASM assets prepared.');
