import { Router } from 'express';
import type { UsersController } from '../controllers/users';
import { requireRole } from '../middlewares/require-role';

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Usuarios]
 *     summary: Lista los usuarios (solo ADMIN; paginada, ordenada por correo)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Página de usuarios, con sus bodegas asignadas (nunca el hash de la contraseña)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ManagedUserPage'
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
 *       403:
 *         description: Solo el ADMIN gestiona usuarios
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   post:
 *     tags: [Usuarios]
 *     summary: Crea un usuario con rol y contraseña inicial (solo ADMIN)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserCreateInput'
 *     responses:
 *       201:
 *         description: Usuario creado (sin bodegas asignadas)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ManagedUser'
 *       400:
 *         description: Datos inválidos (correo, rol o contraseña)
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
 *         description: Solo el ADMIN gestiona usuarios
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Ya existe un usuario con ese correo (sin distinguir mayúsculas)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/users/{id}:
 *   put:
 *     tags: [Usuarios]
 *     summary: Edita un usuario, lo activa o lo desactiva (solo ADMIN)
 *     description: Reemplaza correo, nombre, rol y estado. La contraseña solo cambia si se envía. Un usuario desactivado no puede iniciar sesión ni renovar la sesión.
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
 *             $ref: '#/components/schemas/UserUpdateInput'
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ManagedUser'
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
 *         description: Solo el ADMIN gestiona usuarios
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El usuario no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Ya existe otro usuario con ese correo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/users/{id}/warehouses:
 *   put:
 *     tags: [Usuarios]
 *     summary: Asigna bodegas a un usuario (reemplaza la lista; solo ADMIN)
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
 *             $ref: '#/components/schemas/UserWarehousesInput'
 *     responses:
 *       200:
 *         description: Bodegas asignadas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWarehouses'
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
 *         description: Solo el ADMIN gestiona usuarios
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: El usuario o alguna de las bodegas no existe
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createUsersRouter(controller: UsersController): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.put('/:id/warehouses', controller.setWarehouses);
  return router;
}
