import { Router } from 'express';
import type { TransfersController } from '../controllers/transfers';
import { requireRole } from '../middlewares/require-role';

/**
 * @openapi
 * /api/transfers:
 *   post:
 *     tags: [Traspasos]
 *     summary: Crea un traspaso en borrador entre dos bodegas
 *     description: >
 *       WAREHOUSE_MANAGER y OPERATOR con la bodega de origen asignada. El origen y el destino deben
 *       ser distintos, los productos no se repiten y las cantidades son enteros mayores que 0. El
 *       borrador no mueve stock. El OPERATOR no recibe costos en la respuesta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferCreateInput'
 *     responses:
 *       201:
 *         description: Traspaso creado en DRAFT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferDetail'
 *       400:
 *         description: Datos inválidos (origen igual al destino, producto repetido, cantidad 0...)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Rol no permitido o la bodega de origen no está asignada al usuario
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: La bodega de destino o un producto no existen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   get:
 *     tags: [Traspasos]
 *     summary: Lista los traspasos visibles para el usuario
 *     description: ADMIN y AUDITOR ven todos; el resto, los que tienen una bodega suya como origen o destino.
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [DRAFT, IN_TRANSIT, RECEIVED, DISCREPANCY, RESOLVED, CANCELLED] }
 *       - in: query
 *         name: warehouseId
 *         description: Traspasos donde la bodega es origen o destino
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de traspasos, del más nuevo al más antiguo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferPage'
 *       400:
 *         description: Parámetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/transfers/{id}:
 *   get:
 *     tags: [Traspasos]
 *     summary: Detalle de un traspaso con sus ítems y su línea de eventos
 *     description: El OPERATOR no recibe `unitCost` en los ítems.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Traspaso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferDetail'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Ninguna bodega del traspaso está asignada al usuario
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El traspaso no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/transfers/{id}/cancel:
 *   post:
 *     tags: [Traspasos]
 *     summary: Cancela un traspaso en borrador
 *     description: >
 *       WAREHOUSE_MANAGER con la bodega de origen asignada; el OPERATOR solo si creó el traspaso.
 *       Solo se cancela desde DRAFT; en otro estado responde 409 INVALID_TRANSITION.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferCancelInput'
 *     responses:
 *       200:
 *         description: Traspaso en CANCELLED
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferDetail'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Rol no permitido, bodega de origen no asignada u operario que no creó el traspaso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El traspaso no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: INVALID_TRANSITION, el traspaso ya no está en borrador
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/transfers/{id}/dispatch:
 *   post:
 *     tags: [Traspasos]
 *     summary: Despacha un traspaso (pasa a IN_TRANSIT)
 *     description: >
 *       Solo el WAREHOUSE_MANAGER de la bodega de origen. En una transacción descuenta el stock del
 *       origen, escribe un TRANSFER_OUT por ítem valorado al costo promedio vigente y congela ese
 *       costo en el ítem. El costo promedio del origen no cambia. Repetir el despacho responde 409.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Traspaso en IN_TRANSIT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransferDetail'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Solo el jefe de la bodega de origen despacha
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El traspaso no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: INVALID_TRANSITION (ya despachado o cancelado) o INSUFFICIENT_STOCK (sin cambios)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createTransfersRouter(controller: TransfersController): Router {
  const router = Router();
  const reader = requireRole('ADMIN', 'AUDITOR', 'WAREHOUSE_MANAGER', 'OPERATOR');
  const creator = requireRole('WAREHOUSE_MANAGER', 'OPERATOR');
  router.post('/', creator, controller.create);
  router.get('/', reader, controller.list);
  router.get('/:id', reader, controller.get);
  router.post('/:id/cancel', creator, controller.cancel);
  router.post('/:id/dispatch', requireRole('WAREHOUSE_MANAGER'), controller.dispatch);
  return router;
}
