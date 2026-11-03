import { randomBytes } from 'node:crypto';
import type { Actor } from '../domain/authorization';
import { shouldReceive, type RealtimeEvent } from '../domain/realtime';
import type { WarehouseAccess } from './warehouse-access';

/** Segundos que vive un ticket sin usar. */
export const TICKET_TTL_SECONDS = 30;

/** Una conexión abierta, vista desde el servicio (el WebSocket real queda en realtime-server.ts). */
export interface RealtimeConnection {
  actor: Actor;
  send(message: string): void;
}

export interface RealtimeTicket {
  ticket: string;
  expiresIn: number;
}

export interface RealtimeService {
  /** Ticket aleatorio de un solo uso para abrir el WebSocket (el access token no va en la URL). */
  issueTicket(actor: Actor): RealtimeTicket;
  /** Consume el ticket: devuelve a quién pertenece, o null si no existe, ya se usó o venció. */
  redeemTicket(ticket: string): Actor | null;
  connect(connection: RealtimeConnection): void;
  disconnect(connection: RealtimeConnection): void;
  /** Envía el evento a las conexiones que tienen acceso a alguna de sus bodegas. */
  publish(event: RealtimeEvent): Promise<void>;
}

export interface RealtimeDeps {
  access: WarehouseAccess;
  /** Reloj en milisegundos; las pruebas lo reemplazan para simular el vencimiento. */
  now?: () => number;
}

export function createRealtimeService({ access, now = Date.now }: RealtimeDeps): RealtimeService {
  // Todo en memoria: hay una sola instancia del servidor (Render gratuito)
  const tickets = new Map<string, { actor: Actor; expiresAt: number }>();
  const connections = new Set<RealtimeConnection>();

  function dropExpiredTickets(): void {
    const current = now();
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt <= current) tickets.delete(ticket);
    }
  }

  return {
    issueTicket(actor) {
      dropExpiredTickets();
      const ticket = randomBytes(32).toString('base64url');
      tickets.set(ticket, {
        actor: { userId: actor.userId, role: actor.role },
        expiresAt: now() + TICKET_TTL_SECONDS * 1000,
      });
      return { ticket, expiresIn: TICKET_TTL_SECONDS };
    },

    redeemTicket(ticket) {
      const entry = tickets.get(ticket);
      // Se borra antes de comprobar el vencimiento: un ticket sirve una sola vez pase lo que pase
      tickets.delete(ticket);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry.actor;
    },

    connect(connection) {
      connections.add(connection);
    },

    disconnect(connection) {
      connections.delete(connection);
    },

    async publish(event) {
      // Primero se decide a quién (consultas a la BD) y después se envía todo junto. Si una
      // consulta falla no se envió nada, y el reintento de la cola no duplica mensajes.
      const visibleByUser = new Map<string, Promise<string[] | null>>();
      const recipients: RealtimeConnection[] = [];
      for (const connection of connections) {
        const { userId } = connection.actor;
        let visible = visibleByUser.get(userId);
        if (!visible) {
          visible = access.visibleIds(connection.actor);
          visibleByUser.set(userId, visible);
        }
        if (shouldReceive(event, await visible)) recipients.push(connection);
      }
      const message = JSON.stringify(event);
      for (const connection of recipients) connection.send(message);
    },
  };
}
