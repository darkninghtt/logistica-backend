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
 * /api/auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: Sesiones activas propias
 *     description: Cada sesión es una familia de refresh tokens con un token vigente (un navegador donde se inició sesión). Marca con `current` la de la cookie `refresh_token` de esta petición. Solo devuelve las del usuario del token.
 *     responses:
 *       200:
 *         description: Sesiones activas, la usada más recientemente primero
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Cierra una sesión propia
 *     description: Revoca la familia; su próximo refresh dará 401. Una sesión ajena, inexistente o ya cerrada da 404 (no se revela si existe).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Sesión cerrada
 *       400:
 *         description: Identificador inválido
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
 *         description: La sesión no existe o no es tuya
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Cierra todas las sesiones propias (incluida esta)
 *     description: Revoca todas las familias del usuario y borra la cookie. Los access tokens ya emitidos siguen valiendo hasta que vencen (son cortos).
 *     responses:
 *       204:
 *         description: Sesiones cerradas
 *       401:
 *         description: Token ausente, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 * /api/auth/password:
 *   put:
 *     tags: [Auth]
 *     summary: Cambia la propia contraseña
 *     description: Exige la contraseña actual. Al cambiarla se cierran las demás sesiones del usuario; la de la cookie de esta petición sigue abierta. Cuenta para el límite de intentos fallidos del login.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordChangeInput'
 *     responses:
 *       204:
 *         description: Contraseña cambiada
 *       400:
 *         description: Contraseña actual incorrecta o nueva contraseña inválida
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
 *       429:
 *         description: Demasiados intentos fallidos desde esta IP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export function createAuthRouter(
  controller: AuthController,
  authenticate: RequestHandler,
  limiters: { login: RequestHandler; refresh: RequestHandler },
): Router {
  const router = Router();
  router.post('/login', limiters.login, controller.login);
  router.post('/refresh', limiters.refresh, controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', authenticate, controller.me);
  router.get('/sessions', authenticate, controller.sessions);
  router.delete('/sessions/:id', authenticate, controller.revokeSession);
  router.post('/logout-all', authenticate, controller.logoutAll);
  // Mismo límite que el login: frena que alguien con la sesión abierta adivine la contraseña actual
  router.put('/password', limiters.login, authenticate, controller.changePassword);
  return router;
}
