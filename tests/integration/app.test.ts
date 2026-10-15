import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ConflictError } from '../../src/domain/errors';
import { createHttpLogger } from '../../src/logger';
import { errorHandler, notFoundHandler } from '../../src/middlewares/error-handler';

const logger = pino({ level: 'silent' });
const app = createApp({ logger });

describe('GET /health', () => {
  it('responde 200 con el estado', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('x-correlation-id', () => {
  it('genera uno y lo devuelve en la respuesta si el cliente no lo envía', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeta el que envía el cliente', async () => {
    const res = await request(app).get('/health').set('x-correlation-id', 'mi-id-123');
    expect(res.headers['x-correlation-id']).toBe('mi-id-123');
  });

  it('descarta un id con caracteres no permitidos y genera otro', async () => {
    const res = await request(app).get('/health').set('x-correlation-id', 'id con espacios <x>');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('formato uniforme de errores', () => {
  it('una ruta inexistente devuelve 404 con { code, message, correlationId }', async () => {
    const res = await request(app).get('/no-existe').set('x-correlation-id', 'abc-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Ruta no encontrada',
      correlationId: 'abc-1',
    });
  });

  it('un JSON mal formado devuelve 400 con el mismo formato', async () => {
    const res = await request(app)
      .post('/health')
      .set('content-type', 'application/json')
      .send('{"roto":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.correlationId).toBe('string');
  });
});

describe('middleware global de errores', () => {
  const failing = express();
  failing.use(createHttpLogger(logger));
  failing.get('/dominio', () => {
    throw new ConflictError('El código ya existe');
  });
  failing.get('/boom', () => {
    throw new Error('detalle interno: password=secreto');
  });
  failing.get('/boom-async', async () => {
    await Promise.resolve();
    throw new Error('detalle interno asíncrono');
  });
  failing.use(notFoundHandler);
  failing.use(errorHandler);

  it('traduce un error de dominio a su estado HTTP', async () => {
    const res = await request(failing).get('/dominio');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toBe('El código ya existe');
  });

  it('un error inesperado devuelve 500 sin exponer el mensaje interno ni el stack', async () => {
    const res = await request(failing).get('/boom').set('x-correlation-id', 'boom-1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
      correlationId: 'boom-1',
    });
    expect(res.text).not.toContain('secreto');
    expect(res.text).not.toContain('stack');
  });

  it('también captura los errores de manejadores asíncronos', async () => {
    const res = await request(failing).get('/boom-async');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('asíncrono');
  });
});
