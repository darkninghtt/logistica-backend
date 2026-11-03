import type { RequestHandler } from 'express';
import { getActor } from '../middlewares/authenticate';
import type { RealtimeService } from '../services/realtime';

export interface RealtimeController {
  createTicket: RequestHandler;
}

/** Solo HTTP: entrega el ticket para abrir el WebSocket. */
export function createRealtimeController(service: RealtimeService): RealtimeController {
  return {
    createTicket(req, res) {
      // El ticket es un secreto de un solo uso: que ningún intermediario lo guarde
      res.set('Cache-Control', 'no-store');
      res.status(201).json(service.issueTicket(getActor(req)));
    },
  };
}
