import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  sessionSchema,
} from './schemas/auth';
import { errorResponseSchema } from './schemas/common';
import { productBodySchema, productPageSchema, productSchema } from './schemas/products';
import { realtimeTicketSchema } from './schemas/realtime';
import {
  dashboardSummarySchema,
  inTransitReportSchema,
  kardexPageSchema,
  kardexRowSchema,
  shrinkageReportSchema,
} from './schemas/reports';
import {
  stockEntryBodySchema,
  stockEntryResponseSchema,
  stockLevelSchema,
  stockMovementSchema,
  stockShrinkageBodySchema,
} from './schemas/stock';
import {
  stockLevelItemSchema,
  stockLevelPageSchema,
  stockMovementItemSchema,
  stockMovementPageSchema,
} from './schemas/stock-queries';
import {
  cancelTransferBodySchema,
  createTransferBodySchema,
  receiveTransferBodySchema,
  resolveTransferBodySchema,
  transferDetailSchema,
  transferEventSchema,
  transferItemSchema,
  transferPageSchema,
  transferSummarySchema,
} from './schemas/transfers';
import {
  createUserBodySchema,
  managedUserPageSchema,
  managedUserSchema,
  publicUserSchema,
  updateUserBodySchema,
  userWarehousesBodySchema,
  userWarehousesSchema,
} from './schemas/users';
import {
  warehouseBodySchema,
  warehouseDestinationListSchema,
  warehousePageSchema,
  warehouseRefSchema,
  warehouseSchema,
} from './schemas/warehouses';

/**
 * Contrato de la API: cada esquema de `components.schemas` sale de un esquema Zod. Los de entrada
 * son los mismos que validan las peticiones; los de respuesta los verifica la prueba de contrato
 * (tests/integration/contract.test.ts) contra respuestas reales. Las rutas los citan con
 * `$ref: '#/components/schemas/<nombre>'`. Un esquema anidado que también está en esta lista sale
 * como `$ref`; uno que no está, se escribe completo donde se usa.
 */
export const API_SCHEMAS = {
  // Entradas
  LoginRequest: loginSchema,
  PasswordChangeInput: changePasswordSchema,
  UserCreateInput: createUserBodySchema,
  UserUpdateInput: updateUserBodySchema,
  UserWarehousesInput: userWarehousesBodySchema,
  WarehouseInput: warehouseBodySchema,
  ProductInput: productBodySchema,
  StockEntryInput: stockEntryBodySchema,
  StockShrinkageInput: stockShrinkageBodySchema,
  TransferCreateInput: createTransferBodySchema,
  TransferReceiveInput: receiveTransferBodySchema,
  TransferResolveInput: resolveTransferBodySchema,
  TransferCancelInput: cancelTransferBodySchema,
  // Respuestas
  User: publicUserSchema,
  LoginResponse: loginResponseSchema,
  Session: sessionSchema,
  ManagedUser: managedUserSchema,
  ManagedUserPage: managedUserPageSchema,
  UserWarehouses: userWarehousesSchema,
  Warehouse: warehouseSchema,
  WarehousePage: warehousePageSchema,
  WarehouseRef: warehouseRefSchema,
  WarehouseDestinationList: warehouseDestinationListSchema,
  Product: productSchema,
  ProductPage: productPageSchema,
  StockLevel: stockLevelSchema,
  StockMovement: stockMovementSchema,
  StockEntryResponse: stockEntryResponseSchema,
  StockLevelItem: stockLevelItemSchema,
  StockLevelPage: stockLevelPageSchema,
  StockMovementItem: stockMovementItemSchema,
  StockMovementPage: stockMovementPageSchema,
  KardexRow: kardexRowSchema,
  KardexPage: kardexPageSchema,
  ShrinkageReport: shrinkageReportSchema,
  InTransitReport: inTransitReportSchema,
  DashboardSummary: dashboardSummarySchema,
  TransferSummary: transferSummarySchema,
  TransferPage: transferPageSchema,
  TransferItem: transferItemSchema,
  TransferEvent: transferEventSchema,
  TransferDetail: transferDetailSchema,
  RealtimeTicket: realtimeTicketSchema,
  ErrorResponse: errorResponseSchema,
} satisfies Record<string, z.ZodType>;

export type ApiSchemaName = keyof typeof API_SCHEMAS;

/** Límites de un entero de JavaScript: Zod los escribe en cada `z.int()` y solo ensucian el documento. */
const SAFE_INTEGER_BOUNDS = [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];

/** Convierte los esquemas Zod de `API_SCHEMAS` al formato de OpenAPI 3.0. */
export function buildComponentSchemas(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(API_SCHEMAS)) {
    registry.add(schema, { id });
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    // Lo que el cliente envía: antes de los `transform` y con los `default` como opcionales
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
    override: ({ jsonSchema }) => {
      // `format` (uuid, date-time, email) ya lo dice; la expresión regular de Zod es ruido
      if (jsonSchema.format) delete jsonSchema.pattern;
      if (SAFE_INTEGER_BOUNDS.includes(Number(jsonSchema.minimum))) delete jsonSchema.minimum;
      if (SAFE_INTEGER_BOUNDS.includes(Number(jsonSchema.maximum))) delete jsonSchema.maximum;
    },
  });
  // Cada esquema trae su `$id` (la misma URI de la referencia); en OpenAPI 3.0 no se usa
  for (const schema of Object.values(schemas)) delete schema.$id;
  return schemas;
}

/**
 * Especificación OpenAPI. Las rutas se documentan con comentarios `@openapi` junto a cada router
 * (src/routes/*.ts, o dist/routes/*.js una vez compilado); aquí van los esquemas compartidos.
 */
export function buildOpenApiSpec(): object {
  return swaggerJsdoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'API de logística y trazabilidad de stock',
        version: '0.1.0',
        description: 'Proyecto 21: traspasos inter-bodegas, mermas y costo promedio ponderado.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
        schemas: buildComponentSchemas(),
      },
      // Por defecto todo exige token; el login lo desactiva con `security: []`
      security: [{ bearerAuth: [] }],
    },
    // La búsqueda por patrón exige barras normales (en Windows path.join usa la barra invertida)
    apis: [path.join(__dirname, 'routes', '*.{ts,js}').replaceAll(path.sep, '/')],
  });
}
