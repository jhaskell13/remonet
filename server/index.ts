import { createApp } from './app.ts';
import { config } from './config.ts';

const app = await createApp();
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Graceful shutdown started');
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Graceful shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, 'RemoNet API listening');
} catch (error) {
  app.log.error({ err: error }, 'Could not start RemoNet API');
  await app.close();
  process.exitCode = 1;
}
