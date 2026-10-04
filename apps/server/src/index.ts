import { createGameServer } from './createServer';
import { Telemetry, type LogLevel } from './telemetry/telemetry';

const telemetry = new Telemetry((process.env.LOG_LEVEL ?? 'info') as LogLevel);
const server = await createGameServer({
  port: Number(process.env.PORT ?? 2567),
  host: process.env.HOST ?? '0.0.0.0',
  clientOrigin: process.env.CLIENT_ORIGIN,
  buildSha: process.env.BUILD_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev',
  staticDir: process.env.STATIC_DIR,
  telemetry,
});

const shutdown = async (sig: string) => {
  telemetry.info('shutdown', { sig });
  await server.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
