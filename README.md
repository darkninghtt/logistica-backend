# logistica-backend

API del Proyecto 21: logística y trazabilidad de stock multi-almacén (traspasos, mermas y costo promedio ponderado).

Stack: Node.js 24 (LTS) · Express 5 · TypeScript estricto · Zod · pino · Vitest + Supertest.

## Requisitos

- Node.js 24 (ver `.nvmrc`)
- PostgreSQL local (se usa desde la tarea J2; todavía no es necesario)

## Puesta en marcha

```bash
npm install
cp .env.example .env   # en PowerShell: Copy-Item .env.example .env
npm run dev
```

Comprobar: `GET http://localhost:3000/health` → `{ "status": "ok" }`.

## Scripts

| Script              | Qué hace                                      |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Arranca la API con recarga (lee `.env`)       |
| `npm run build`     | Compila a `dist/`                             |
| `npm start`         | Ejecuta lo compilado (`dist/main.js`)         |
| `npm run lint`      | ESLint + comprobación de formato con Prettier |
| `npm run format`    | Aplica Prettier                               |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm test`          | Pruebas con Vitest                            |

## Estructura

```
src/  main.ts (única composición) · app.ts · config.ts · logger.ts
      domain/ (reglas puras y errores) · routes/ · controllers/ · middlewares/
tests/  unit/ · integration/
```

Capas por recurso: `routes → controller → service → repository`. Las carpetas `schemas/`, `services/` y `repositories/` se crean cuando aparece el primer recurso que las necesita.

## Errores y trazabilidad

- Todo error responde `{ code, message, correlationId }`; los errores inesperados devuelven 500 sin detalles internos.
- Cada petición lleva `x-correlation-id` (se toma del header si es válido o se genera) y aparece en los logs y en la respuesta.
