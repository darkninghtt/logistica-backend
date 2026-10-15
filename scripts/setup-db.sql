-- Crea el usuario y las bases de datos locales del proyecto.
-- Se ejecuta UNA vez por máquina, con el superusuario de PostgreSQL:
--   psql -U postgres -h localhost -f scripts/setup-db.sql
-- La contraseña de abajo es solo para desarrollo local (la misma que en .env.example).

CREATE ROLE logistica LOGIN PASSWORD 'logistica_dev';
CREATE DATABASE logistica_dev OWNER logistica;
CREATE DATABASE logistica_test OWNER logistica;
