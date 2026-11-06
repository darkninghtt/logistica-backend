import { readFileSync, writeFileSync } from 'node:fs';
import { buildOpenApiSpec } from './swagger';

/*
 * Escribe el contrato de la API en `openapi.json` (raíz del repo), del que el frontend genera sus
 * tipos. Con `--check` no escribe: termina con error si el archivo no está al día (lo usa el CI).
 *   npm run openapi         → regenera openapi.json
 *   npm run openapi:check   → falla si alguien cambió la API y no regeneró
 */

const FILE = 'openapi.json';

/** Las rutas ordenadas por URL, para que el archivo no dependa del orden en que se leen los routers. */
function renderOpenApi(): string {
  const spec = buildOpenApiSpec();
  const ordered = Object.fromEntries(
    Object.entries(spec).map(([key, value]) =>
      key === 'paths' && typeof value === 'object' && value !== null
        ? [key, Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))]
        : [key, value],
    ),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function readCurrent(): string {
  try {
    return readFileSync(FILE, 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return '';
  }
}

const expected = renderOpenApi();
if (process.argv.includes('--check')) {
  if (readCurrent() !== expected) {
    process.stderr.write(`${FILE} no está al día con los esquemas: ejecuta "npm run openapi".\n`);
    process.exit(1);
  }
  process.stdout.write(`${FILE} está al día.\n`);
} else {
  writeFileSync(FILE, expected);
  process.stdout.write(`${FILE} actualizado.\n`);
}
