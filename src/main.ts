import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { createLogger } from './logger';
import { createUsersRepository } from './repositories/users';
import { createAuthService } from './services/auth';
import { createArgon2Hasher } from './services/password-hasher';
import { createTokenService } from './services/token-service';

function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger(config);

  // Única composición: aquí se crean las dependencias y se inyectan hacia abajo
  const pool = createPool(config.DATABASE_URL);
  const tokens = createTokenService({
    secret: config.JWT_SECRET,
    expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS,
  });
  const authService = createAuthService({
    users: createUsersRepository(pool),
    hasher: createArgon2Hasher(),
    tokens,
  });
  const app = createApp({ logger, authService, tokens });

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
