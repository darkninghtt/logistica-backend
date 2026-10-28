import { Router } from 'express';
import type { WarehousesController } from '../controllers/warehouses';
import { requireRole } from '../middlewares/require-role';

/**
 * @openapi
 * /api/warehouses/destinations:
 *   get:
 *     tags: [Bodegas]
 *     summary: Bodegas activas que se pueden elegir como destino de un traspaso
 *     description: >
 *       Cualquier usuario autenticado recibe todas las bodegas activas (id, código y nombre), no solo
 *       las asignadas: quien crea un traspaso necesita elegir una bodega de otra persona como destino.
 *       Sin paginación, ordenadas por código.
 *     responses:
 *       200:
 *         description: Bodegas activas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WarehouseDestinationList'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/warehouses:
 *   get:
 *     tags: [Bodegas]
 *     summary: Lista las bodegas (paginada, ordenadas por código)
 *     description: ADMIN y AUDITOR ven todas; WAREHOUSE_MANAGER y OPERATOR, solo las asignadas.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de bodegas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WarehousePage'
 *       400:
 *         description: Parámetros de paginación inválidos
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
 *   post:
 *     tags: [Bodegas]
 *     summary: Crea una bodega (solo ADMIN)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WarehouseInput'
 *     responses:
 *       201:
 *         description: Bodega creada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Warehouse'
 *       400:
 *         description: Datos inválidos
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
 *         description: Solo el ADMIN crea bodegas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Ya existe una bodega con ese código
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/warehouses/{id}:
 *   put:
 *     tags: [Bodegas]
 *     summary: Edita una bodega (solo ADMIN; reemplaza código, nombre y estado activo)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WarehouseInput'
 *     responses:
 *       200:
 *         description: Bodega actualizada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Warehouse'
 *       400:
 *         description: Datos o identificador inválidos
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
 *         description: Solo el ADMIN edita bodegas
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
 *       409:
 *         description: Ya existe otra bodega con ese código
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createWarehousesRouter(controller: WarehousesController): Router {
  const router = Router();
  router.get('/', controller.list);
  router.get('/destinations', controller.listDestinations);
  router.post('/', requireRole('ADMIN'), controller.create);
  router.put('/:id', requireRole('ADMIN'), controller.update);
  return router;
}
