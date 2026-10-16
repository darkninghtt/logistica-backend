import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { idParamSchema, pageQuerySchema } from '../../src/schemas/page';
import { parseWith } from '../../src/schemas/parse';

describe('pageQuerySchema', () => {
  it('usa página 1 y 20 por página por defecto', () => {
    expect(parseWith(pageQuerySchema, {})).toEqual({ page: 1, pageSize: 20 });
  });

  it('convierte el texto de la query a números', () => {
    expect(parseWith(pageQuerySchema, { page: '2', pageSize: '5' })).toEqual({
      page: 2,
      pageSize: 5,
    });
  });

  it.each([{ page: '0' }, { page: 'x' }, { pageSize: '0' }, { pageSize: '101' }])(
    'rechaza %o',
    (query) => {
      expect(() => parseWith(pageQuerySchema, query)).toThrow(ValidationError);
    },
  );
});

describe('idParamSchema', () => {
  it('rechaza un id que no es UUID', () => {
    expect(() => parseWith(idParamSchema, { id: '123' })).toThrow(ValidationError);
  });
});
