import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHttpLogger, createLogger } from '../../src/logger';

describe('logger', () => {
  it('registra la petición con su correlation id pero sin Authorization ni cookies', async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { LOG_LEVEL: 'info' },
      {
        write(line: string): void {
          lines.push(line);
        },
      },
    );
    const app = express();
    app.use(createHttpLogger(logger));
    app.get('/x', (_req, res) => {
      res.json({});
    });

    await request(app)
      .get('/x')
      .set('x-correlation-id', 'log-1')
      .set('Authorization', 'Bearer token-secreto')
      .set('Cookie', 'sid=abc');

    const output = lines.join('');
    expect(output).toContain('"correlationId":"log-1"');
    expect(output).not.toContain('token-secreto');
    expect(output).not.toContain('sid=abc');
  });
});
