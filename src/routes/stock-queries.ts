import { Router } from 'express';
import type { StockQueryController } from '../controllers/stock-queries';

/**
 * @openapi
 * /api/stock:
 *   get:
 *     tags: [Stock]
 *     summary: Existencias de una bodega (cantidad, costo promedio y valor total por producto)
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de niveles de stock, ordenados por SKU
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockLevelPage'
 *       400:
 *         description: Falta la bodega o los parámetros son inválidos
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
 *       404:
 *         description: La bodega no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/stock/movements:
 *   get:
 *     tags: [Stock]
 *     summary: Historial de movimientos de una bodega, con el saldo y el costo después de cada uno
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: productId
 *         description: Filtra los movimientos de un producto
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de movimientos, del más nuevo al más antiguo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockMovementPage'
 *       400:
 *         description: Falta la bodega o los parámetros son inválidos
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
 *       404:
 *         description: La bodega o el producto no existen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createStockQueryRouter(controller: StockQueryController): Router {
  const router = Router();
  router.get('/', controller.listLevels);
  router.get('/movements', controller.listMovements);
  return router;
}
