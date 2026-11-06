import type { RequestHandler } from 'express';
import helmet from 'helmet';

/** Rutas de Swagger UI: llevan su propia CSP (ver abajo). */
const DOCS_PREFIX = '/api-docs';

/**
 * CSP de la aplicación (frontend y API). Todo sale del mismo origen:
 * - `script-src 'self'`: sin scripts en línea ni de otros dominios (el build de Vite no los usa).
 * - `connect-src 'self'`: la API y el WebSocket (`wss://` del mismo origen) están en el mismo host.
 * - `style-src` admite estilos en línea (los usan Vue y Swagger); no ejecutan código.
 * - Sin `upgrade-insecure-requests`: en local la app corre por http y Render ya fuerza https.
 */
const APP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: null,
};

/**
 * Swagger UI necesita algo más: sus íconos y el sello del validador pueden venir como imágenes
 * https. Sigue sin permitir scripts en línea ni de otros dominios.
 */
const DOCS_DIRECTIVES = {
  ...APP_DIRECTIVES,
  imgSrc: ["'self'", 'data:', 'https:'],
};

/**
 * Cabeceras de seguridad estándar con `helmet` (CSP, HSTS, `X-Content-Type-Options`,
 * `Referrer-Policy`, `X-Frame-Options`...). `/api-docs` usa su propia CSP; el resto, la estricta.
 */
export function createSecurityHeaders(): RequestHandler {
  const appHeaders = helmet({ contentSecurityPolicy: { directives: APP_DIRECTIVES } });
  const docsHeaders = helmet({ contentSecurityPolicy: { directives: DOCS_DIRECTIVES } });
  return (req, res, next) => {
    const isDocs = req.path === DOCS_PREFIX || req.path.startsWith(`${DOCS_PREFIX}/`);
    (isDocs ? docsHeaders : appHeaders)(req, res, next);
  };
}
