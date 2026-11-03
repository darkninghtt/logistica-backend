import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RealtimeConnection, RealtimeService } from './services/realtime';

export const REALTIME_PATH = '/api/realtime';
/** Cada cuánto se hace ping; la conexión que no respondió al anterior se cierra. */
export const HEARTBEAT_MS = 30_000;

export interface RealtimeServerOptions {
  realtime: RealtimeService;
  logger: Logger;
  heartbeatMs?: number;
}

export interface RealtimeServer {
  close(): Promise<void>;
}

function reject(socket: Duplex, status: 401 | 404, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Monta el WebSocket sobre el mismo servidor HTTP (mismo origen y puerto que la API). La
 * autenticación ocurre en el `upgrade`: sin un ticket válido se responde 401 y no se abre nada.
 * Esta petición no pasa por Express, así que el ticket de la URL no llega al log de peticiones.
 */
export function attachRealtime(
  server: Server,
  { realtime, logger, heartbeatMs = HEARTBEAT_MS }: RealtimeServerOptions,
): RealtimeServer {
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== REALTIME_PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }
    const ticket = url.searchParams.get('ticket');
    const actor = ticket ? realtime.redeemTicket(ticket) : null;
    if (!actor) {
      logger.info('WebSocket rechazado: ticket ausente, vencido o ya usado');
      reject(socket, 401, 'Unauthorized');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection: RealtimeConnection = {
        actor,
        send(message) {
          if (ws.readyState === ws.OPEN) ws.send(message);
        },
      };
      alive.set(ws, true);
      realtime.connect(connection);
      logger.info({ userId: actor.userId }, 'WebSocket conectado');

      ws.on('pong', () => alive.set(ws, true));
      ws.on('error', (err) => logger.warn({ userId: actor.userId, err }, 'Error en el WebSocket'));
      ws.on('close', () => {
        realtime.disconnect(connection);
        logger.info({ userId: actor.userId }, 'WebSocket cerrado');
      });
    });
  });

  // Ping/pong: cierra las conexiones muertas (por ejemplo, un portátil que se suspendió)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
