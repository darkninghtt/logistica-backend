# logistica-backend

API del Proyecto 21: logística y trazabilidad de stock multi-almacén (traspasos, mermas y costo promedio ponderado).

Stack: Node.js 24 (LTS) · Express 5 · TypeScript estricto · Zod · pino · Vitest + Supertest.

## Requisitos

- Node.js 24 (ver `.nvmrc`)
- PostgreSQL 18 local (cualquier versión reciente sirve)

## Puesta en marcha

```bash
npm install
cp .env.example .env   # en PowerShell: Copy-Item .env.example .env
npm run dev
```

## Base de datos

Una vez por máquina, crea el usuario y las bases de desarrollo y de pruebas con el superusuario de PostgreSQL:

```bash
psql -U postgres -h localhost -f scripts/setup-db.sql
```

Luego aplica las migraciones (`npm run migrate:up`). Las pruebas aplican las suyas solas sobre `TEST_DATABASE_URL`.

Migraciones versionadas con `node-pg-migrate` en `migrations/` (archivos `.sql`). Nunca se edita una migración ya aplicada: se crea una nueva. Se ejecutan como paso de despliegue, no al arrancar la app.

| Script                                          | Qué hace                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `npm run migrate:up`                            | Aplica las migraciones pendientes (BD de desarrollo) |
| `npm run migrate:down`                          | Revierte la última migración                         |
| `npm run migrate:test:up` / `migrate:test:down` | Lo mismo sobre la BD de pruebas                      |

## Usuario ADMIN y login

```bash
npm run seed   # crea el ADMIN de desarrollo (datos en .env; es idempotente)
```

- `POST /api/auth/login` devuelve `{ accessToken, user }`. El token (JWT, 15 min) se envía como `Authorization: Bearer <token>`.
- `GET /api/auth/me` devuelve el usuario del token. Todo `/api` exige token, salvo el login.
- Contraseñas con Argon2id. Documentación interactiva en `http://localhost:3000/api-docs`.

## Comprobar que la API responde

`GET http://localhost:3000/health` → `{ "status": "ok" }`.

## Scripts

| Script              | Qué hace                                      |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Arranca la API con recarga (lee `.env`)       |
| `npm run build`     | Compila a `dist/`                             |
| `npm start`         | Ejecuta lo compilado (`dist/main.js`)         |
| `npm run seed`      | Crea el usuario ADMIN de desarrollo           |
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
