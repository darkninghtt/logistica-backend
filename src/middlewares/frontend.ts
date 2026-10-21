import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type RequestHandler } from 'express';

/** Rutas que pertenecen al backend: nunca se responden con el `index.html` del frontend. */
const BACKEND_PREFIXES = ['/api', '/api-docs', '/health'];

function isBackendPath(urlPath: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

/**
 * Sirve el build del frontend (carpeta `publicDir`) y, para las rutas del router de Vue, responde
 * `index.html` (así recargar `/stock` no da 404). Si la carpeta no tiene `index.html` (desarrollo
 * local, donde Vite sirve el frontend) devuelve `null` y no se monta nada.
 */
export function createFrontendHandlers(publicDir: string): RequestHandler[] | null {
  const root = path.resolve(publicDir);
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) return null;

  const fallback: RequestHandler = (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isBackendPath(req.path)) {
      next();
      return;
    }
    res.sendFile(indexFile);
  };
  return [express.static(root), fallback];
}
