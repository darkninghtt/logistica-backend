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
 * /api/reports/kardex/export:
 *   get:
 *     tags: [Reportes]
 *     summary: Exporta el kardex completo a CSV o PDF
 *     description: >
 *       Mismo contenido y permisos que el kardex, sin paginar. El CSV va en UTF-8 con BOM (Excel
 *       muestra bien las tildes) y neutraliza los textos que empiezan como fórmula; el PDF se
 *       genera en el servidor por streaming.
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
 *         name: format
 *         required: true
 *         schema: { type: string, enum: [csv, pdf] }
 *     responses:
 *       200:
 *         description: Archivo para descargar (Content-Disposition attachment)
 *         content:
 *           text/csv:
 *             schema: { type: string, format: binary }
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400:
 *         description: Faltan parámetros o el formato no es csv ni pdf
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
 * /api/reports/shrinkage:
 *   get:
 *     tags: [Reportes]
 *     summary: Reporte de mermas (de bodega y en tránsito) con cantidades y valores
 *     description: >
 *       Agrupado por bodega, producto, tipo y motivo. El motivo de una merma de bodega es su
 *       código (sin la nota); la merma en tránsito no se agrupa por motivo y figura en la bodega
 *       de destino. El valor es cantidad × costo con que se registró cada merma; los totales se
 *       suman con decimales exactos. ADMIN y AUDITOR, todas las bodegas; WAREHOUSE_MANAGER, las
 *       suyas.
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         description: Sin bodega, todas las visibles para el usuario
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         description: Fecha inicial (AAAA-MM-DD, inclusive, hora de Colombia)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         description: Fecha final (AAAA-MM-DD, inclusive, hora de Colombia)
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Filas y totales
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShrinkageReport'
 *       400:
 *         description: Parámetros inválidos o la fecha inicial es posterior a la final
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
 * /api/reports/shrinkage/export:
 *   get:
 *     tags: [Reportes]
 *     summary: Exporta el reporte de mermas a CSV o PDF (con la fila de totales)
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         description: Sin bodega, todas las visibles para el usuario
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         description: Fecha inicial (AAAA-MM-DD, inclusive, hora de Colombia)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         description: Fecha final (AAAA-MM-DD, inclusive, hora de Colombia)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: format
 *         required: true
 *         schema: { type: string, enum: [csv, pdf] }
 *     responses:
 *       200:
 *         description: Archivo para descargar (Content-Disposition attachment)
 *         content:
 *           text/csv:
 *             schema: { type: string, format: binary }
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400:
 *         description: Parámetros inválidos o el formato no es csv ni pdf
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
 * /api/reports/in-transit:
 *   get:
 *     tags: [Reportes]
 *     summary: Traspasos en tránsito, con días en tránsito y valor al costo congelado
 *     description: >
 *       Traspasos IN_TRANSIT donde la bodega es origen o destino (sin bodega, todas las
 *       visibles), del despacho más antiguo al más nuevo. Mismos permisos que los demás reportes.
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         description: Bodega de origen o de destino; sin ella, todas las visibles
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Traspasos y totales
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InTransitReport'
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
 *       403:
 *         description: OPERATOR, o la bodega no está asignada al jefe de bodega
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/reports/summary:
 *   get:
 *     tags: [Reportes]
 *     summary: Totales del dashboard
 *     description: >
 *       Valor del inventario por bodega activa (cantidad × costo promedio), traspasos por estado,
 *       mermas de los últimos 30 días (de bodega y en tránsito) y valor de la mercancía en tránsito
 *       al costo congelado. ADMIN y AUDITOR ven todas las bodegas; el jefe de bodega, solo las
 *       suyas (los traspasos cuentan si su bodega es origen o destino). Valores como texto con 4
 *       decimales.
 *     responses:
 *       200:
 *         description: Resumen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardSummary'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: OPERATOR
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();
  // Mismos permisos para todos los reportes (datos de costo); el servicio lo repite
  const canView = requireRole('ADMIN', 'AUDITOR', 'WAREHOUSE_MANAGER');
  router.get('/kardex', canView, controller.kardex);
  router.get('/kardex/export', canView, controller.exportKardex);
  router.get('/shrinkage', canView, controller.shrinkage);
  router.get('/shrinkage/export', canView, controller.exportShrinkage);
  router.get('/in-transit', canView, controller.inTransit);
  router.get('/summary', canView, controller.summary);
  return router;
}
