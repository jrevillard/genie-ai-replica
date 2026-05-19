import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _pool: pg.Pool | undefined;

export function getDb() {
  if (!_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

export function initDb(databaseUrl: string) {
  _pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  _db = drizzle(_pool, { schema });
  return _db;
}

export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
}

export { schema };
