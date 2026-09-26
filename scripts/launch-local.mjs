import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const address = 'http://127.0.0.1:3000';
async function ready() {
  try {
    const response = await fetch(address + '/api/projects', { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.projects) && typeof data.ai === 'object';
  } catch { return false; }
}
if (await ready()) {
  console.log('Research Workbench is already running: ' + address);
} else {
  const prepared = spawnSync(process.execPath, ['scripts/prepare-pdf-assets.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (prepared.status !== 0) throw new Error('PDF asset preparation failed.');
  mkdirSync(new URL('../outputs/local-run/', import.meta.url), { recursive: true });
  const out = openSync(new URL('../outputs/local-run/server.log', import.meta.url), 'a');
  const err = openSync(new URL('../outputs/local-run/server-error.log', import.meta.url), 'a');
  const service = spawn(process.execPath, ['scripts/start-local.mjs'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, err],
  });
  let startupError;
  service.on('error', error => { startupError = error; });
  service.unref(); closeSync(out); closeSync(err);
  let started = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (startupError) throw startupError;
    if (await ready()) { started = true; break; }
    await delay(1000);
  }
  if (!started) throw new Error('Service did not become ready. See outputs/local-run/server-error.log; port 3000 may be occupied.');
  console.log('Research Workbench is ready, no sign-in required: ' + address);
}
