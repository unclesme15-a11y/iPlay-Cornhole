import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
const server = await startServer(config);

const shutdown = async (signal: string): Promise<void> => {
  server.app.log.info({ signal }, 'shutting down');
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    server.app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.app.log.info({ port: config.PORT, liveMatches: server.services.registry.size }, 'iPlay Cornhole server ready');
