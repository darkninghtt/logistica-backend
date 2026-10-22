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
npm run seed   # crea el ADMIN y los usuarios de demo de .env (es idempotente)
```

El seed crea el ADMIN y, si sus variables están definidas (`SEED_MANAGER_*`, `SEED_OPERATOR_*`, `SEED_AUDITOR_*`), un jefe de bodega, un operario y un auditor, con las bodegas de ejemplo `BOD-A` y `BOD-B` (el jefe y el operario quedan asignados a `BOD-A`). Con `NODE_ENV=production` rechaza las contraseñas de desarrollo de `.env.example`: en la nube hay que definir contraseñas propias en las variables de entorno.

El ADMIN gestiona usuarios por la API (Swagger, etiqueta _Usuarios_): `GET`/`POST /api/users`, `PUT /api/users/:id` (editar, activar o desactivar) y `PUT /api/users/:id/warehouses` (reemplaza las bodegas asignadas). Nunca se devuelve el hash de la contraseña.

- `POST /api/auth/login` devuelve `{ accessToken, user }`. El token (JWT, 15 min) se envía como `Authorization: Bearer <token>`. Además fija la cookie `refresh_token` (`HttpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` en producción).
- `POST /api/auth/refresh` (usa la cookie) devuelve un access token nuevo y rota la cookie; reutilizar un refresh ya rotado revoca toda la sesión. `POST /api/auth/logout` revoca la sesión y borra la cookie. En BD solo se guarda el hash del refresh token.
- Rate limiting por IP: 300 peticiones por minuto sobre `/api` y 10 intentos fallidos por 15 minutos en login y refresh (responde `429`). Se configura con las variables `RATE_LIMIT_*` de `.env.example`.
- `GET /api/auth/me` devuelve el usuario del token. Todo `/api` exige token, salvo el login.
- Contraseñas con Argon2id. Documentación interactiva en `http://localhost:3000/api-docs`.

## Comprobar que la API responde

`GET http://localhost:3000/health` → `{ "status": "ok" }`.

## Despliegue (Render + Neon, un solo origen)

El backend sirve el build del frontend (`public/`) y la API bajo `/api`, todo desde la misma URL (así la cookie `SameSite=Strict` del refresh funcionará). El `Dockerfile` de varias etapas clona el repo público del frontend (`FRONTEND_REPO`, `FRONTEND_REF`), lo compila, compila el backend y deja una sola imagen. Las rutas del router de Vue (por ejemplo `/stock`) devuelven `index.html`; `/api`, `/api-docs` y `/health` no se tocan.

**Variables de entorno en Render** (nunca en el repositorio):

| Variable       | Valor                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `production`                                                                              |
| `DATABASE_URL` | Cadena de conexión de Neon (con `sslmode=require`)                                        |
| `JWT_SECRET`   | Secreto propio de producción, 32 caracteres o más (por ejemplo `openssl rand -base64 48`) |
| `TRUST_PROXY`  | `1` (Render pone un proxy delante)                                                        |
| `PORT`         | Lo define Render; no hace falta ponerlo                                                   |

**Pasos (la primera vez)**

1. En Neon, crear el proyecto y copiar la cadena de conexión.
2. **Migraciones (paso de despliegue, no al arrancar la app)**, desde tu PC contra Neon:
   ```powershell
   $env:DATABASE_URL = "<cadena de Neon>"; npm run migrate:up
   ```
3. Crear el ADMIN en la base desplegada, con una contraseña de producción (mínimo 12 caracteres, distinta de la de desarrollo):
   ```powershell
   $env:DATABASE_URL = "<cadena de Neon>"; $env:SEED_ADMIN_EMAIL = "<correo>"; $env:SEED_ADMIN_PASSWORD = "<contraseña>"; npm run seed
   ```
4. En Render: New → Web Service → este repositorio → Runtime **Docker** → plan Free → variables de la tabla → deploy.
5. Comprobar `https://<servicio>.onrender.com/health`, la aplicación y `/api-docs`.

**Volver a desplegar:** cada push a `main` redespliega solo (o _Manual Deploy_ en Render). Si el frontend cambió y el backend no, usar _Manual Deploy → Clear build cache & deploy_ para que se vuelva a clonar. Si hay migraciones nuevas, correr el paso 2 **antes** de desplegar.

**Límites de los planes gratuitos** (verificados el 2026-10-20; revisar antes de sustentar):

- Render (servicio web): se apaga tras 15 min sin tráfico y tarda ~1 min en volver; 750 horas de instancia al mes. Su Postgres gratuito expira a los 30 días, por eso la BD está en Neon.
- Neon: 1 GB por proyecto y 100 CU-horas al mes; el cómputo se suspende tras 5 min sin uso (la primera consulta tarda un poco más). No vence.
- **Calentar antes de una sustentación:** abrir `/health` unos 2 minutos antes y luego iniciar sesión una vez para despertar también la base.

## Scripts

| Script              | Qué hace                                      |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Arranca la API con recarga (lee `.env`)       |
| `npm run build`     | Compila a `dist/`                             |
| `npm start`         | Ejecuta lo compilado (`dist/main.js`)         |
| `npm run seed`      | Crea el ADMIN y los usuarios de demo          |
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
