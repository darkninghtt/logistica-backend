import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { TRANSITIONS } from '../../src/domain/transfer';
import { createTestPool } from '../helpers/db';

/*
 * Los diagramas Mermaid del README no se quedan viejos: el entidad-relación debe tener las mismas
 * tablas y columnas que la base migrada, y el de estados, las mismas transiciones que
 * `TRANSITIONS` (src/domain/transfer.ts).
 */

const pool: Pool = createTestPool();
const readme = readFileSync('README.md', 'utf8').replaceAll('\r\n', '\n');

function mermaidBlock(kind: string): string {
  const block = readme
    .split('```mermaid\n')
    .slice(1)
    .map((part) => part.split('```')[0] ?? '')
    .find((part) => part.trimStart().startsWith(kind));
  if (!block) throw new Error(`El README no tiene un diagrama ${kind}`);
  return block;
}

afterAll(async () => {
  await pool.end();
});

describe('diagramas del README', () => {
  it('el entidad-relación coincide con las tablas y columnas de las migraciones', async () => {
    const fromReadme: Record<string, string[]> = {};
    for (const [, table = '', body = ''] of mermaidBlock('erDiagram').matchAll(
      /^\s{4}(\w+) \{\n([\s\S]*?)\n\s{4}\}/gm,
    )) {
      fromReadme[table] = body
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[1] ?? '')
        .sort();
    }

    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`,
    );
    const fromDb: Record<string, string[]> = {};
    for (const { table_name, column_name } of rows) {
      (fromDb[table_name] ??= []).push(column_name);
    }
    for (const columns of Object.values(fromDb)) columns.sort();

    expect(fromReadme).toEqual(fromDb);
  });

  it('el diagrama de estados tiene exactamente las transiciones del dominio', () => {
    const fromReadme = [...mermaidBlock('stateDiagram').matchAll(/^\s*(\w+) --> (\w+)/gm)]
      .map(([, from, to]) => `${from} → ${to}`)
      .sort();
    const fromDomain = Object.entries(TRANSITIONS)
      .flatMap(([from, targets]) => targets.map((to) => `${from} → ${to}`))
      .sort();
    expect(fromReadme).toEqual(fromDomain);
  });
});
