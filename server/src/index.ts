import { buildApp } from './app';
import { config } from './config';
import { closeDb } from './db';
import { toErrorMessage } from './lib/errors';
import { claimNextJobs, failJob, recoverStaleJobs } from './queue/jobs';
import { processChunkJob } from './queue/worker';

async function runBatch(): Promise<void> {
  let jobs;
  try {
    jobs = await claimNextJobs(5);
  } catch (err) {
    console.error(`[worker] claim failed: ${toErrorMessage(err)}`);
    return;
  }
  await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        await processChunkJob(job);
      } catch (err) {
        const message = toErrorMessage(err);
        console.error(`[worker] chunk ${job.chunk_id} attempt ${job.attempts} failed: ${message}`);
        try {
          await failJob(job, message);
        } catch (failErr) {
          console.error(`[worker] failed to record job failure: ${toErrorMessage(failErr)}`);
        }
      }
    }),
  );
}

async function main(): Promise<void> {
  const app = await buildApp();

  await recoverStaleJobs();
  const timer = setInterval(() => {
    void runBatch();
  }, config.JOB_POLL_MS);
  timer.unref();
  void runBatch();

  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    clearInterval(timer);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
