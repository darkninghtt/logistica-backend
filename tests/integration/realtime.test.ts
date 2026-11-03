import { createServer, type Server } from 'node:http';
import type { Pool } from 'pg';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../../src/app';
import { attachRealtime, type RealtimeServer } from '../../src/realtime-server';
import { createRealtimeService, TICKET_TTL_SECONDS } from '../../src/services/realtime';
import { allowAllAccess } from '../helpers/actors';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const base = buildTestApp(pool);

// Todo lo que se registra (peticiones HTTP y WebSocket) queda aquí para revisar que no salga el ticket
const logLines: string[] = [];
const logger = pino({ level: 'info' }, { write: (line: string) => void logLines.push(line) });
const app = createApp({ ...base.deps, logger });

const PASSWORD = 'Clave-segura-123';

type Who = 'ADMIN' | 'AUDITOR' | 'MANAGER_A' | 'MANAGER_B' | 'OPERATOR_C';
const tokens: Partial<Record<Who, string>> = {};
let warehouseA: string;
let warehouseB: string;
let warehouseC: string;
let product: string;

let server: Server;
let realtimeServer: RealtimeServer;
let baseUrl: string;
const openSockets: WebSocket[] = [];

function portOf(httpServer: Server): number {
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('El servidor no escucha');
  return address.port;
}

function as(who: Who): { Authorization: string } {
  return { Authorization: `Bearer ${tokens[who] ?? ''}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken;
}

async function createUser(
  who: Exclude<Who, 'ADMIN'>,
  role: 'WAREHOUSE_MANAGER' | 'OPERATOR' | 'AUDITOR',
  warehouseIds: string[],
): Promise<void> {
  const email = `${who.toLowerCase()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(as('ADMIN'))
    .send({ email, name: who, role, password: PASSWORD });
  expect(created.status).toBe(201);
  await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds });
  tokens[who] = await login(email, PASSWORD);
}

async function ticketFor(who: Who): Promise<string> {
  const res = await request(app).post('/api/realtime/ticket').set(as(who));
  expect(res.status).toBe(201);
  return res.body.ticket;
}

/** Abre el WebSocket; devuelve la conexión o el código HTTP con que se rechazó el handshake. */
function connect(url: string): Promise<WebSocket | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => {
      openSockets.push(ws);
      resolve(ws);
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
    ws.once('error', reject);
  });
}

interface Inbox {
  messages: { type: string; payload: Record<string, unknown> }[];
  raw: string[];
}

async function listen(who: Who): Promise<Inbox> {
  const ws = await connect(`${baseUrl}/api/realtime?ticket=${await ticketFor(who)}`);
  if (typeof ws === 'number') throw new Error(`Handshake rechazado con ${ws}`);
  const inbox: Inbox = { messages: [], raw: [] };
  ws.on('message', (data) => {
    const text = String(data);
    inbox.raw.push(text);
    inbox.messages.push(JSON.parse(text));
  });
  return inbox;
}

/** Espera hasta que la condición se cumpla (los mensajes viajan por la red, no llegan al instante). */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Se agotó la espera');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Barrera: una entrada en la bodega indicada genera un último `stock.changed` para ella. La cola
 * envía en orden y cada conexión entrega en orden, así que cuando ese aviso llega, cualquier aviso
 * anterior para esa persona ya llegó también. Sirve para afirmar que algo NO se recibió.
 */
async function barrier(warehouseId: string, inbox: Inbox): Promise<void> {
  await entry(warehouseId, 1, '1');
  await until(() =>
    inbox.messages.some((m) => m.type === 'stock.changed' && m.payload.warehouseId === warehouseId),
  );
}

async function entry(warehouseId: string, quantity: number, unitCost: string): Promise<void> {
  const res = await request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId, productId: product, quantity, unitCost });
  expect(res.status).toBe(201);
}

async function draft(quantity: number): Promise<string> {
  const res = await request(app)
    .post('/api/transfers')
    .set(as('MANAGER_A'))
    .send({
      originWarehouseId: warehouseA,
      destinationWarehouseId: warehouseB,
      items: [{ productId: product, quantity }],
    });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  server = createServer(app);
  realtimeServer = attachRealtime(server, { realtime: base.realtime, logger });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `ws://127.0.0.1:${portOf(server)}`;
});

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  tokens.ADMIN = await login(ADMIN.email, ADMIN.password);
  const makeWarehouse = async (code: string): Promise<string> =>
    (
      await request(app)
        .post('/api/warehouses')
        .set(as('ADMIN'))
        .send({ code, name: `Bodega ${code}` })
    ).body.id;
  warehouseA = await makeWarehouse('A');
  warehouseB = await makeWarehouse('B');
  warehouseC = await makeWarehouse('C');
  product = (
    await request(app)
      .post('/api/products')
      .set(as('ADMIN'))
      .send({ sku: 'SKU-1', name: 'Producto 1', unit: 'un' })
  ).body.id;
  await createUser('MANAGER_A', 'WAREHOUSE_MANAGER', [warehouseA]);
  await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', [warehouseB]);
  await createUser('OPERATOR_C', 'OPERATOR', [warehouseC]);
  await createUser('AUDITOR', 'AUDITOR', []);
  await entry(warehouseA, 10, '100');
  // Los avisos de la preparación no deben llegar a las conexiones de cada prueba
  await base.queue.idle();
  logLines.length = 0;
});

afterEach(() => {
  for (const ws of openSockets.splice(0)) ws.terminate();
});

afterAll(async () => {
  await realtimeServer.close();
  await new Promise((resolve) => server.close(resolve));
  await truncateAll(pool);
  await pool.end();
});

describe('POST /api/realtime/ticket', () => {
  it('sin access token responde 401', async () => {
    const res = await request(app).post('/api/realtime/ticket');
    expect(res.status).toBe(401);
  });

  it('entrega un ticket de un solo uso que vence en 30 s, sin caché', async () => {
    const res = await request(app).post('/api/realtime/ticket').set(as('OPERATOR_C'));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticket: expect.any(String), expiresIn: 30 });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('handshake del WebSocket', () => {
  it('sin ticket se rechaza con 401', async () => {
    expect(await connect(`${baseUrl}/api/realtime`)).toBe(401);
  });

  it('con un ticket inventado se rechaza con 401', async () => {
    expect(await connect(`${baseUrl}/api/realtime?ticket=inventado`)).toBe(401);
  });

  it('un ticket ya usado se rechaza con 401', async () => {
    const ticket = await ticketFor('MANAGER_B');
    expect(await connect(`${baseUrl}/api/realtime?ticket=${ticket}`)).toBeInstanceOf(WebSocket);
    expect(await connect(`${baseUrl}/api/realtime?ticket=${ticket}`)).toBe(401);
  });

  it('un ticket vencido se rechaza con 401', async () => {
    // Servidor aparte con un reloj controlado, para no esperar 30 s de verdad
    let clock = 1_000_000;
    const realtime = createRealtimeService({ access: allowAllAccess, now: () => clock });
    const other = createServer();
    const attached = attachRealtime(other, { realtime, logger: pino({ level: 'silent' }) });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const url = `ws://127.0.0.1:${portOf(other)}/api/realtime`;
    try {
      const { ticket } = realtime.issueTicket({ userId: 'u-1', role: 'ADMIN' });
      clock += TICKET_TTL_SECONDS * 1000 + 1;
      expect(await connect(`${url}?ticket=${ticket}`)).toBe(401);
    } finally {
      await attached.close();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('otra ruta distinta de /api/realtime se rechaza con 404', async () => {
    const ticket = await ticketFor('ADMIN');
    expect(await connect(`${baseUrl}/api/otra?ticket=${ticket}`)).toBe(404);
  });

  it('el ticket no aparece en los logs, ni al usarlo ni al rechazarlo', async () => {
    const used = await ticketFor('ADMIN');
    await connect(`${baseUrl}/api/realtime?ticket=${used}`);
    await connect(`${baseUrl}/api/realtime?ticket=${used}`);
    // Un GET normal (sin upgrade) sí pasa por Express y por el log de peticiones
    const plain = await ticketFor('ADMIN');
    await request(app).get(`/api/realtime?ticket=${plain}`);

    const output = logLines.join('');
    expect(output).toContain('WebSocket conectado');
    expect(output).toContain('WebSocket rechazado');
    expect(output).not.toContain(used);
    expect(output).not.toContain(plain);
  });
});

describe('eventos', () => {
  it('un despacho llega al jefe del destino, al jefe del origen y al AUDITOR, no a un operario ajeno', async () => {
    const id = await draft(4);
    await base.queue.idle();
    const [managerA, managerB, auditor, operatorC] = await Promise.all([
      listen('MANAGER_A'),
      listen('MANAGER_B'),
      listen('AUDITOR'),
      listen('OPERATOR_C'),
    ]);

    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    expect(res.status).toBe(200);

    const expected = {
      type: 'transfer.updated',
      payload: {
        transferId: id,
        status: 'IN_TRANSIT',
        originWarehouseId: warehouseA,
        destinationWarehouseId: warehouseB,
      },
    };
    await until(() => managerB.messages.length > 0 && auditor.messages.length >= 2);
    expect(managerB.messages).toEqual([expected]);
    expect(auditor.messages).toEqual([
      expected,
      { type: 'stock.changed', payload: { warehouseId: warehouseA, productIds: [product] } },
    ]);
    await until(() => managerA.messages.length >= 2);
    expect(managerA.messages[0]).toEqual(expected);

    await barrier(warehouseC, operatorC);
    expect(operatorC.messages.map((m) => m.type)).toEqual(['stock.changed']);
  });

  it('los mensajes no traen costos ni más campos que los acordados', async () => {
    const auditor = await listen('AUDITOR');
    const id = await draft(2);
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    await entry(warehouseB, 3, '250.5');
    await until(() => auditor.messages.length >= 4);

    for (const text of auditor.raw) expect(text.toLowerCase()).not.toContain('cost');
    for (const { type, payload } of auditor.messages) {
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(
        type === 'transfer.updated'
          ? ['destinationWarehouseId', 'originWarehouseId', 'status', 'transferId']
          : ['productIds', 'warehouseId'],
      );
    }
  });

  it('una transacción que falla no emite nada', async () => {
    const id = await draft(50); // A solo tiene 10
    await base.queue.idle();
    const managerA = await listen('MANAGER_A');

    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    expect(res.status).toBe(409);

    await barrier(warehouseA, managerA);
    expect(managerA.messages).toEqual([
      { type: 'stock.changed', payload: { warehouseId: warehouseA, productIds: [product] } },
    ]);
  });

  it('un despacho repetido (409) no vuelve a avisar', async () => {
    const id = await draft(2);
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    await base.queue.idle();
    const managerB = await listen('MANAGER_B');

    const again = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    expect(again.status).toBe(409);

    await barrier(warehouseB, managerB);
    expect(managerB.messages.map((m) => m.type)).toEqual(['stock.changed']);
  });

  it('una recepción con faltante avisa DISCREPANCY y el stock que entró al destino', async () => {
    const id = await draft(4);
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    await base.queue.idle();
    const managerA = await listen('MANAGER_A');

    const res = await request(app)
      .post(`/api/transfers/${id}/receive`)
      .set(as('MANAGER_B'))
      .send({ items: [{ productId: product, receivedQuantity: 3 }] });
    expect(res.status).toBe(200);

    await until(() => managerA.messages.length > 0);
    expect(managerA.messages).toEqual([
      {
        type: 'transfer.updated',
        payload: {
          transferId: id,
          status: 'DISCREPANCY',
          originWarehouseId: warehouseA,
          destinationWarehouseId: warehouseB,
        },
      },
    ]);
  });
});

describe('heartbeat', () => {
  it('el servidor hace ping periódicamente', async () => {
    const realtime = createRealtimeService({ access: allowAllAccess });
    const other = createServer();
    const attached = attachRealtime(other, {
      realtime,
      logger: pino({ level: 'silent' }),
      heartbeatMs: 30,
    });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const port = portOf(other);
    try {
      const { ticket } = realtime.issueTicket({ userId: 'u-1', role: 'ADMIN' });
      const ws = await connect(`ws://127.0.0.1:${port}/api/realtime?ticket=${ticket}`);
      if (typeof ws === 'number') throw new Error('Handshake rechazado');
      let pings = 0;
      ws.on('ping', () => pings++);
      await until(() => pings >= 2);
      // El cliente responde pong solo, así que la conexión sigue viva
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      await attached.close();
      await new Promise((resolve) => other.close(resolve));
    }
  });
});
