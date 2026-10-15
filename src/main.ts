import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  const app = createApp({ logger });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Servidor escuchando');
  });
}

try {
  main();
} catch (err) {
  // Aún no hay logger si la configuración falla, por eso se escribe directo a stderr
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
