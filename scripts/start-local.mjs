import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const child = spawn(process.execPath, [
  'scripts/dev-workbench.mjs', '--hostname', '127.0.0.1', '--port', '3000',
], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, WORKBENCH_LOCAL_ACCESS: '1', WORKBENCH_URL: 'http://127.0.0.1:3000' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
