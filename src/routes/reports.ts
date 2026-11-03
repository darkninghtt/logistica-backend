import { Router } from 'express';
import type { ReportsController } from '../controllers/reports';
import { requireRole } from '../middlewares/require-role';

/**
 * @openapi
 * /api/reports/kardex:
 *   get:
 *     tags: [Reportes]
 *     summary: Kardex valorizado de un producto en una bodega
 *     description: >
 *       Movimientos del libro en orden cronológico, cada uno con su entrada, salida, saldo, costo
 *       unitario, CPP resultante y valor del saldo. Sale tal cual del libro (no se recalcula nada).
 *       La merma en tránsito no es entrada ni salida: el saldo no cambia y la cantidad perdida va en
 *       `quantity`. Paginación por cursor: la primera página sin `cursor` y las siguientes con el
 *       `nextCursor` de la anterior. ADMIN y AUDITOR, cualquier bodega; WAREHOUSE_MANAGER, solo
 *       las asignadas; el OPERATOR no tiene acceso (son datos de costo).
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: cursor
 *         description: El `nextCursor` de la página anterior
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Página del kardex con los datos de la bodega y del producto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KardexPage'
 *       400:
 *         description: Falta la bodega o el producto, o un parámetro o el cursor son inválidos
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
 *         description: OPERATOR, o la bodega no está asignada al jefe de bodega
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
export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();
  router.get('/kardex', requireRole('ADMIN', 'AUDITOR', 'WAREHOUSE_MANAGER'), controller.kardex);
  return router;
}
