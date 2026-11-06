import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/domain/authorization';
import { ForbiddenError } from '../../src/domain/errors';
import { daysInTransit, type ShrinkageReportRow } from '../../src/domain/reports';
import { sumValues } from '../../src/domain/stock';
import { kardexCsv, kardexPdf, toCsv } from '../../src/services/report-files';
import { createReportsService, type ReportsStore } from '../../src/services/reports';
import { createWarehouseAccess } from '../../src/services/warehouse-access';
import { allowAllAccess } from '../helpers/actors';

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

describe('toCsv', () => {
  it('empieza con BOM, separa con coma y termina cada línea en CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿a,b\r\n1,x\r\n');
  });

  it('pone entre comillas lo que lleva coma, comillas o salto de línea, y duplica las comillas', () => {
    const csv = toCsv(['texto'], [['uno, dos'], ['dice "hola"'], ['línea\nnueva']]);
    expect(csv.split('\r\n').slice(1, 4)).toEqual([
      '"uno, dos"',
      '"dice ""hola"""',
      '"línea\nnueva"',
    ]);
  });

  it.each(['=SUMA(A1)', '+57 300', '-2+3', '@cmd'])(
    'neutraliza el texto %s para que Excel no lo ejecute como fórmula',
    (text) => {
      expect(toCsv(['x'], [[text]]).split('\r\n')[1]).toBe(`'${text}`);
    },
  );

  it('los números no se tocan (las cantidades no son fórmulas)', () => {
    expect(toCsv(['n'], [[-3]]).split('\r\n')[1]).toBe('-3');
  });

  it('conserva las tildes y la ñ', () => {
    expect(toCsv(['Año'], [['Merma en tránsito']])).toContain('Merma en tránsito');
  });
});

describe('archivos del kardex', () => {
  const data = {
    warehouse: { id: A, code: 'BOD A', name: 'Bodega A' },
    product: { id: 'p', sku: 'SKU/1', name: 'Tornillo', unit: 'un' },
    rows: [],
  };

  it('el nombre del archivo solo lleva caracteres seguros', () => {
    expect(kardexCsv(data).filename).toBe('kardex-BOD_A-SKU_1.csv');
  });

  it('el PDF es un stream que empieza por %PDF', async () => {
    const file = kardexPdf(data, new Date('2026-11-03T12:00:00Z'));
    expect(file.contentType).toBe('application/pdf');
    if (!(file.body instanceof Readable)) throw new Error('El PDF debería ser un stream');
    const chunks: Buffer[] = [];
    for await (const chunk of file.body) chunks.push(Buffer.from(chunk));
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });
});

describe('daysInTransit y sumValues', () => {
  it('cuenta días completos desde el despacho', () => {
    const now = new Date('2026-11-05T10:00:00Z');
    expect(daysInTransit('2026-11-05T09:00:00Z', now)).toBe(0);
    expect(daysInTransit('2026-11-04T10:00:00Z', now)).toBe(1);
    expect(daysInTransit('2026-11-01T11:00:00Z', now)).toBe(3);
  });

  it('suma valores con decimales exactos (0.1 + 0.2 no da 0.30000000000000004)', () => {
    expect(sumValues(['0.1', '0.2'])).toBe('0.3000');
    expect(sumValues(['208.2352', '104.1176', '90.0000'])).toBe('402.3528');
    expect(sumValues([])).toBe('0.0000');
  });
});

describe('ReportsService: mermas y en tránsito', () => {
  const ADMIN: Actor = { userId: 'u-admin', role: 'ADMIN' };
  const MANAGER_A: Actor = { userId: 'u-jefe-a', role: 'WAREHOUSE_MANAGER' };
  const row = (value: string, quantity: number): ShrinkageReportRow => ({
    warehouseId: A,
    warehouseCode: 'A',
    warehouseName: 'Bodega A',
    productId: 'p',
    productSku: 'SKU-1',
    productName: 'Tornillo',
    type: 'SHRINKAGE',
    reason: 'DAMAGE',
    quantity,
    value,
  });

  function fakeStore(): ReportsStore {
    return {
      findWarehouse: vi.fn(async () => null),
      findProduct: vi.fn(async () => null),
      listKardex: vi.fn(async () => []),
      listShrinkage: vi.fn(async () => [row('208.2352', 2), row('90.0000', 1)]),
      inventoryByWarehouse: vi.fn(async () => []),
      countTransfersByStatus: vi.fn(async () => []),
      shrinkageTotalsSince: vi.fn(async () => ({ quantity: 0, value: '0.0000' })),
      listInTransit: vi.fn(async () => [
        {
          transferId: 't-1',
          originWarehouseId: A,
          originCode: 'A',
          originName: 'Bodega A',
          destinationWarehouseId: B,
          destinationCode: 'B',
          destinationName: 'Bodega B',
          dispatchedAt: '2026-11-01T10:00:00.000Z',
          quantity: 2,
          value: '208.2352',
        },
      ]),
    };
  }
  const managerAccess = createWarehouseAccess({
    assignments: { warehouseIdsOf: async () => [A] },
  });

  it('suma los totales con decimales exactos y pasa la zona horaria de los reportes', async () => {
    const store = fakeStore();
    const report = await createReportsService({ store, access: allowAllAccess }).shrinkage(
      { from: '2026-11-01', to: '2026-11-03' },
      ADMIN,
    );

    expect(report.totals).toEqual({ quantity: 3, value: '298.2352' });
    expect(store.listShrinkage).toHaveBeenCalledWith({
      warehouseIds: null,
      from: '2026-11-01',
      to: '2026-11-03',
      timeZone: 'America/Bogota',
    });
  });

  it('sin bodega, el jefe solo consulta las suyas; una ajena da 403 sin consultar', async () => {
    const store = fakeStore();
    const service = createReportsService({ store, access: managerAccess });

    await service.shrinkage({}, MANAGER_A);
    expect(store.listShrinkage).toHaveBeenLastCalledWith(
      expect.objectContaining({ warehouseIds: [A] }),
    );

    await expect(service.shrinkage({ warehouseId: B }, MANAGER_A)).rejects.toThrow(ForbiddenError);
    await expect(service.inTransit({ warehouseId: B }, MANAGER_A)).rejects.toThrow(ForbiddenError);
    expect(store.listInTransit).not.toHaveBeenCalled();
  });

  it('el OPERATOR recibe 403 en los reportes y en las exportaciones', async () => {
    const service = createReportsService({ store: fakeStore(), access: allowAllAccess });
    const operator: Actor = { userId: 'u-op', role: 'OPERATOR' };

    await expect(service.shrinkage({}, operator)).rejects.toThrow(ForbiddenError);
    await expect(service.inTransit({}, operator)).rejects.toThrow(ForbiddenError);
    await expect(service.exportShrinkage({ format: 'csv' }, operator)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      service.exportKardex({ warehouseId: A, productId: 'p', format: 'pdf' }, operator),
    ).rejects.toThrow(ForbiddenError);
  });

  it('calcula los días en tránsito con el reloj del servicio y suma los totales', async () => {
    const report = await createReportsService({
      store: fakeStore(),
      access: allowAllAccess,
      now: () => new Date('2026-11-04T12:00:00Z'),
    }).inTransit({}, ADMIN);

    expect(report.data[0]?.daysInTransit).toBe(3);
    expect(report.totals).toEqual({ transfers: 1, quantity: 2, value: '208.2352' });
  });

  it('exporta el kardex completo pidiendo tandas hasta que no haya más', async () => {
    const store = fakeStore();
    const movement = (id: number) => ({
      id: String(id),
      productId: 'p',
      warehouseId: A,
      type: 'ENTRY' as const,
      quantity: 1,
      unitCost: '1.0000',
      balanceQty: id,
      balanceAvgCost: '1.0000',
      reason: null,
      transferId: null,
      createdBy: 'u',
      createdAt: '2026-11-01T10:00:00.000Z',
    });
    store.findWarehouse = vi.fn(async () => ({ id: A, code: 'A', name: 'Bodega A' }));
    store.findProduct = vi.fn(async () => ({ id: 'p', sku: 'S', name: 'P', unit: 'un' }));
    store.listKardex = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => movement(i + 1)))
      .mockResolvedValueOnce([movement(501)]);

    const file = await createReportsService({ store, access: allowAllAccess }).exportKardex(
      { warehouseId: A, productId: 'p', format: 'csv' },
      ADMIN,
    );

    expect(store.listKardex).toHaveBeenNthCalledWith(1, A, 'p', 500, undefined);
    expect(store.listKardex).toHaveBeenNthCalledWith(2, A, 'p', 500, '500');
    expect(typeof file.body === 'string' && file.body.trimEnd().split('\r\n')).toHaveLength(502);
  });
});
