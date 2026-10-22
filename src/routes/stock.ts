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
 */
export function createStockRouter(controller: StockController): Router {
  const router = Router();
  router.post('/entries', requireRole('ADMIN', 'WAREHOUSE_MANAGER'), controller.createEntry);
  return router;
}
