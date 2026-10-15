import { migrateTestDatabase } from './helpers/db';

/** Antes de todas las pruebas: la BD de pruebas queda con el esquema al día. */
export default async function setup(): Promise<void> {
  await migrateTestDatabase('up');
}
