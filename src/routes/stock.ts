import { Router } from 'express';
import type { StockController } from '../controllers/stock';
import { requireRole } from '../middlewares/require-role';

/**
 * @openapi
 * /api/stock/entries:
 *   post:
 *     tags: [Stock]
 *     summary: Registra una entrada de stock y recalcula el costo promedio ponderado (CPP)
 *     description: >
 *       En una sola transacción bloquea el nivel de stock de la bodega y el producto, recalcula
 *       el CPP, actualiza el nivel y agrega el movimiento al libro. Los costos viajan como string.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StockEntryInput'
 *     responses:
 *       201:
 *         description: Entrada registrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockEntryResponse'
 *       400:
 *         description: Datos inválidos (cantidad, costo o identificadores)
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
 *         description: Solo el ADMIN (cualquier bodega) y el WAREHOUSE_MANAGER (sus bodegas asignadas) registran entradas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El producto o la bodega no existen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/stock/shrinkage:
 *   post:
 *     tags: [Stock]
 *     summary: Registra una merma de bodega (daño, vencimiento, robo o ajuste de conteo)
 *     description: >
 *       Descuenta stock al costo promedio vigente y deja un movimiento `SHRINKAGE` en el libro. No
 *       cambia el CPP y no puede dejar el stock negativo. Todo ocurre en una transacción con el
 *       nivel de stock bloqueado. El motivo queda en `reason` del movimiento (el código y, si hay
 *       nota, "CÓDIGO: nota"). WAREHOUSE_MANAGER y OPERATOR, solo en sus bodegas asignadas; el
 *       OPERATOR no recibe campos de costo en la respuesta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StockShrinkageInput'
 *     responses:
 *       201:
 *         description: Merma registrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockEntryResponse'
 *       400:
 *         description: Datos inválidos (cantidad, motivo o identificadores)
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
 *         description: Solo el WAREHOUSE_MANAGER y el OPERATOR, y únicamente en sus bodegas asignadas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El producto no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Stock insuficiente (`INSUFFICIENT_STOCK`); no se cambia nada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createStockRouter(controller: StockController): Router {
  const router = Router();
  router.post('/entries', requireRole('ADMIN', 'WAREHOUSE_MANAGER'), controller.createEntry);
  router.post(
    '/shrinkage',
    requireRole('WAREHOUSE_MANAGER', 'OPERATOR'),
    controller.createShrinkage,
  );
  return router;
}
