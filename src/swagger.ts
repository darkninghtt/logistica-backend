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
