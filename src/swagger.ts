import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import { ROLES } from './domain/user';

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
        schemas: {
          LoginRequest: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email', example: 'admin@logistica.local' },
              password: { type: 'string', example: 'tu-contraseña' },
            },
          },
          User: {
            type: 'object',
            required: ['id', 'name', 'email', 'role'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              role: { type: 'string', enum: [...ROLES] },
            },
          },
          LoginResponse: {
            type: 'object',
            required: ['accessToken', 'user'],
            properties: {
              accessToken: { type: 'string', description: 'JWT de corta duración' },
              user: { $ref: '#/components/schemas/User' },
            },
          },
          Warehouse: {
            type: 'object',
            required: ['id', 'code', 'name', 'active', 'createdAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              code: { type: 'string', example: 'BOD-A' },
              name: { type: 'string', example: 'Bodega A' },
              active: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          WarehouseInput: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', maxLength: 20, example: 'BOD-A' },
              name: { type: 'string', maxLength: 100, example: 'Bodega A' },
              active: { type: 'boolean', default: true },
            },
          },
          WarehousePage: {
            type: 'object',
            required: ['data', 'page', 'pageSize', 'total'],
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/Warehouse' } },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          Product: {
            type: 'object',
            required: ['id', 'sku', 'name', 'unit', 'createdAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              sku: { type: 'string', example: 'SKU-001' },
              name: { type: 'string', example: 'Tornillo 1/4' },
              unit: { type: 'string', example: 'un' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          ProductInput: {
            type: 'object',
            required: ['sku', 'name', 'unit'],
            properties: {
              sku: { type: 'string', maxLength: 40, example: 'SKU-001' },
              name: { type: 'string', maxLength: 100, example: 'Tornillo 1/4' },
              unit: { type: 'string', maxLength: 20, example: 'un' },
            },
          },
          ProductPage: {
            type: 'object',
            required: ['data', 'page', 'pageSize', 'total'],
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          StockEntryInput: {
            type: 'object',
            required: ['warehouseId', 'productId', 'quantity', 'unitCost'],
            properties: {
              warehouseId: { type: 'string', format: 'uuid' },
              productId: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer', minimum: 1, maximum: 1000000000, example: 10 },
              unitCost: {
                type: 'string',
                description: 'Costo unitario mayor que 0, con hasta 4 decimales (como texto)',
                example: '100.0000',
              },
            },
          },
          StockLevel: {
            type: 'object',
            required: ['productId', 'warehouseId', 'quantity', 'avgCost', 'totalValue'],
            properties: {
              productId: { type: 'string', format: 'uuid' },
              warehouseId: { type: 'string', format: 'uuid' },
              quantity: { type: 'integer', example: 20 },
              avgCost: {
                type: 'string',
                description: 'Costo promedio ponderado',
                example: '110.0000',
              },
              totalValue: {
                type: 'string',
                description: 'quantity × avgCost',
                example: '2200.0000',
              },
            },
          },
          StockMovement: {
            type: 'object',
            required: [
              'id',
              'productId',
              'warehouseId',
              'type',
              'quantity',
              'unitCost',
              'balanceQty',
              'balanceAvgCost',
              'createdBy',
              'createdAt',
            ],
            properties: {
              id: { type: 'string', example: '1' },
              productId: { type: 'string', format: 'uuid' },
              warehouseId: { type: 'string', format: 'uuid' },
              type: { type: 'string', enum: ['ENTRY'] },
              quantity: { type: 'integer', example: 10 },
              unitCost: { type: 'string', example: '120.0000' },
              balanceQty: { type: 'integer', description: 'Saldo después del movimiento' },
              balanceAvgCost: {
                type: 'string',
                description: 'Costo promedio después del movimiento',
              },
              createdBy: { type: 'string', format: 'uuid' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          StockEntryResponse: {
            type: 'object',
            required: ['movement', 'stockLevel'],
            properties: {
              movement: { $ref: '#/components/schemas/StockMovement' },
              stockLevel: { $ref: '#/components/schemas/StockLevel' },
            },
          },
          StockLevelItem: {
            allOf: [
              { $ref: '#/components/schemas/StockLevel' },
              {
                type: 'object',
                required: ['productSku', 'productName', 'productUnit'],
                properties: {
                  productSku: { type: 'string', example: 'SKU-001' },
                  productName: { type: 'string', example: 'Tornillo 1/4' },
                  productUnit: { type: 'string', example: 'un' },
                },
              },
            ],
          },
          StockLevelPage: {
            type: 'object',
            required: ['data', 'page', 'pageSize', 'total'],
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/StockLevelItem' } },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          StockMovementItem: {
            allOf: [
              { $ref: '#/components/schemas/StockMovement' },
              {
                type: 'object',
                required: ['productSku', 'productName'],
                properties: {
                  productSku: { type: 'string', example: 'SKU-001' },
                  productName: { type: 'string', example: 'Tornillo 1/4' },
                },
              },
            ],
          },
          StockMovementPage: {
            type: 'object',
            required: ['data', 'page', 'pageSize', 'total'],
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/StockMovementItem' } },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          ErrorResponse: {
            type: 'object',
            required: ['code', 'message', 'correlationId'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'TOO_MANY_REQUESTS',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string' },
              correlationId: { type: 'string' },
            },
          },
        },
      },
      // Por defecto todo exige token; el login lo desactiva con `security: []`
      security: [{ bearerAuth: [] }],
    },
    // La búsqueda por patrón exige barras normales (en Windows path.join usa la barra invertida)
    apis: [path.join(__dirname, 'routes', '*.{ts,js}').replaceAll(path.sep, '/')],
  });
}
