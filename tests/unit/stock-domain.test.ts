import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { applyEntry, MAX_QUANTITY, totalValue } from '../../src/domain/stock';

const EMPTY = { quantity: 0, avgCost: '0.0000' };

describe('applyEntry (CPP)', () => {
  it('la primera entrada fija el costo promedio al costo de la entrada', () => {
    expect(applyEntry(EMPTY, { quantity: 10, unitCost: '100' })).toEqual({
      quantity: 10,
      avgCost: '100.0000',
    });
  });

  it('10 u a $100 + 10 u a $120 da 20 u a $110', () => {
    const first = applyEntry(EMPTY, { quantity: 10, unitCost: '100' });
    expect(applyEntry(first, { quantity: 10, unitCost: '120' })).toEqual({
      quantity: 20,
      avgCost: '110.0000',
    });
  });

  it('entradas sucesivas ponderan por cantidad', () => {
    let balance = applyEntry(EMPTY, { quantity: 10, unitCost: '100' });
    balance = applyEntry(balance, { quantity: 30, unitCost: '200' });
    // (10×100 + 30×200) / 40 = 175
    expect(balance).toEqual({ quantity: 40, avgCost: '175.0000' });
    balance = applyEntry(balance, { quantity: 10, unitCost: '75' });
    // (40×175 + 10×75) / 50 = 155
    expect(balance).toEqual({ quantity: 50, avgCost: '155.0000' });
  });

  it('redondea a 4 decimales con "half up"', () => {
    const first = applyEntry(EMPTY, { quantity: 1, unitCost: '10' });
    // (1×10 + 2×11) / 3 = 10.666666... → 10.6667
    expect(applyEntry(first, { quantity: 2, unitCost: '11' }).avgCost).toBe('10.6667');
    // (2×10 + 1×10.0001) / 3 = 10.0000333... → 10.0000
    const two = applyEntry(EMPTY, { quantity: 2, unitCost: '10' });
    expect(applyEntry(two, { quantity: 1, unitCost: '10.0001' }).avgCost).toBe('10.0000');
    // (1×10 + 1×10.0001) / 2 = 10.00005 → half up = 10.0001
    expect(applyEntry(first, { quantity: 1, unitCost: '10.0001' }).avgCost).toBe('10.0001');
  });

  it('no usa punto flotante: 0.1 + 0.2 sale exacto', () => {
    const first = applyEntry(EMPTY, { quantity: 1, unitCost: '0.1' });
    expect(applyEntry(first, { quantity: 1, unitCost: '0.2' }).avgCost).toBe('0.1500');
  });

  it('con stock cero (por ejemplo tras vaciar la bodega) el costo anterior no pesa', () => {
    const emptied = { quantity: 0, avgCost: '999.0000' };
    expect(applyEntry(emptied, { quantity: 5, unitCost: '20' })).toEqual({
      quantity: 5,
      avgCost: '20.0000',
    });
  });

  it('no modifica el balance recibido', () => {
    const current = { quantity: 10, avgCost: '100.0000' };
    applyEntry(current, { quantity: 10, unitCost: '120' });
    expect(current).toEqual({ quantity: 10, avgCost: '100.0000' });
  });

  it.each([0, -5, 1.5, Number.NaN])('rechaza la cantidad %s', (quantity) => {
    expect(() => applyEntry(EMPTY, { quantity, unitCost: '10' })).toThrow(ValidationError);
  });

  it.each(['0', '0.0000', '-1', 'abc', '', '10.12345', '12345678901'])(
    'rechaza el costo "%s"',
    (unitCost) => {
      expect(() => applyEntry(EMPTY, { quantity: 1, unitCost })).toThrow(ValidationError);
    },
  );

  it('rechaza un saldo que supere el máximo', () => {
    const almostFull = { quantity: MAX_QUANTITY, avgCost: '1.0000' };
    expect(() => applyEntry(almostFull, { quantity: 1, unitCost: '1' })).toThrow(ValidationError);
  });
});

describe('totalValue', () => {
  it('es cantidad × costo promedio con 4 decimales', () => {
    expect(totalValue({ quantity: 20, avgCost: '110.0000' })).toBe('2200.0000');
    expect(totalValue({ quantity: 3, avgCost: '10.3333' })).toBe('30.9999');
  });
});
