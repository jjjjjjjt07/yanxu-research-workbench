import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const pkg = JSON.parse(
  readFileSync(
    new URL('../node_modules/vinext/package.json', import.meta.url),
    'utf8',
  ),
);
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vinext;
const server = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/vinext/' + bin, import.meta.url)),
    'dev',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', windowsHide: true },
);
const worker = process.env.JOB_RUNNER_SECRET
  ? spawn(
      process.execPath,
      [fileURLToPath(new URL('./graph-runner.mjs', import.meta.url))],
      { stdio: 'inherit', windowsHide: true },
    )
  : null;
if (!worker)
  console.log(
    'Background extraction is unavailable until JOB_RUNNER_SECRET is configured.',
  );
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  worker?.kill();
  server.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('exit', (code) => stop(code ?? 1));
server.on('error', (error) => {
  console.error(error.message);
  stop(1);
});
worker?.on('error', (error) => {
  console.error('Background executor failed: ' + error.message);
  stop(1);
});
