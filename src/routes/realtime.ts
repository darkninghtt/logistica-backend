import { Router } from 'express';
import type { RealtimeController } from '../controllers/realtime';

/**
 * @openapi
 * /api/realtime/ticket:
 *   post:
 *     tags: [Tiempo real]
 *     summary: Entrega un ticket de un solo uso para abrir el WebSocket
 *     description: >
 *       El navegador no puede enviar `Authorization` al abrir un WebSocket y el access token no debe
 *       ir en la URL. Por eso se pide aquí (autenticado) un ticket aleatorio que vence en 30 s y
 *       sirve una sola vez. Con él se abre `wss://<mismo origen>/api/realtime?ticket=...`; sin
 *       ticket válido (ausente, vencido o ya usado) el servidor rechaza el handshake con 401.
 *       Por el WebSocket llegan mensajes JSON `{ type, payload }`: `transfer.updated`
 *       (`{ transferId, status, originWarehouseId, destinationWarehouseId }`) y `stock.changed`
 *       (`{ warehouseId, productIds }`), sin costos. ADMIN y AUDITOR reciben todos; el jefe de
 *       bodega y el operario, solo los de sus bodegas asignadas. Los eventos salen después de
 *       confirmar la transacción. El servidor hace ping cada 30 s y cierra las conexiones muertas.
 *     responses:
 *       201:
 *         description: Ticket emitido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RealtimeTicket'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createRealtimeRouter(controller: RealtimeController): Router {
  const router = Router();
  router.post('/ticket', controller.createTicket);
  return router;
}
