import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/auth';

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Inicia sesión
 *     description: Devuelve un access token (JWT corto) y los datos del usuario, y fija el refresh token en la cookie `refresh_token` (HttpOnly, SameSite=Strict, Path=/api/auth). Con límite de intentos fallidos por IP. Es de los pocos endpoints de /api que no exigen token.
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
 *         headers:
 *           Set-Cookie:
 *             description: Cookie `refresh_token` (HttpOnly; SameSite=Strict; Secure en producción; Path=/api/auth)
 *             schema:
 *               type: string
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
 *         description: Correo o contraseña incorrectos, o usuario desactivado (no se indica cuál)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Demasiados intentos fallidos desde esta IP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Renueva la sesión
 *     description: Usa la cookie `refresh_token` (no lleva cuerpo). Devuelve un access token nuevo y rota la cookie. Reutilizar un refresh token ya rotado revoca toda la sesión (familia) y responde 401.
 *     security: []
 *     responses:
 *       200:
 *         description: Sesión renovada
 *         headers:
 *           Set-Cookie:
 *             description: Cookie `refresh_token` nueva (rotada)
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Sin cookie, token inexistente, vencido, reutilizado o usuario desactivado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Demasiados intentos fallidos desde esta IP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Cierra la sesión
 *     description: Revoca la sesión del refresh token de la cookie y borra la cookie. Si no hay cookie igual responde 204.
 *     security: []
 *     responses:
 *       204:
 *         description: Sesión cerrada
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
export function createAuthRouter(
  controller: AuthController,
  authenticate: RequestHandler,
  authLimiter: RequestHandler,
): Router {
  const router = Router();
  router.post('/login', authLimiter, controller.login);
  router.post('/refresh', authLimiter, controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', authenticate, controller.me);
  return router;
}
