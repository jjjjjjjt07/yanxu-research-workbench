import { setTimeout as delay } from 'node:timers/promises';

export async function waitForJob(api, projectId, jobId) {
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    const { jobs } = await api(`/api/projects/${projectId}`);
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error('Test job was not returned by its project.');
    if (job.status === 'succeeded') return;
    if (['failed', 'cancelled'].includes(job.status))
      throw new Error(job.error || `Job ${job.status}`);
    await delay(1500);
  }
  throw new Error('Background job did not finish within the test deadline.');
}
