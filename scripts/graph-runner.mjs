// Independent persistent executor: restarting resumes jobs from D1; closing a browser has no effect.
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.WORKBENCH_URL || 'http://localhost:3000';
const url = new URL(base);
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(url.hostname)
)
  throw new Error('Remote executor requires HTTPS.');
const secret = process.env.JOB_RUNNER_SECRET;
if (!secret || secret.length < 32)
  throw new Error(
    'Configure JOB_RUNNER_SECRET in the server and executor (at least 32 characters).',
  );
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
console.log(
  'Research background executor started. Durable jobs resume automatically.',
);
while (!stopped) {
  try {
    const response = await fetch(
      `${base.replace(/\/$/, '')}/api/internal/graph-runner`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(225000),
      },
    );
    if (!response.ok) throw new Error(`Executor HTTP ${response.status}`);
    const result = await response.json();
    if (!result.idle) console.log(JSON.stringify(result));
    await delay(result.idle ? 3000 : 300);
  } catch (e) {
    console.error(e.message);
    await delay(10000);
  }
}
