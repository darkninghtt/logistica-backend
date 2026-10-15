import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/auth';

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Inicia sesión
 *     description: Devuelve un access token (JWT corto) y los datos del usuario. Es el único endpoint de /api que no exige token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Sesión iniciada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Datos inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Correo o contraseña incorrectos (no se indica cuál de los dos falló)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Datos del usuario autenticado
 *     responses:
 *       200:
 *         description: Usuario del token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createAuthRouter(controller: AuthController, authenticate: RequestHandler): Router {
  const router = Router();
  router.post('/login', controller.login);
  router.get('/me', authenticate, controller.me);
  return router;
}
