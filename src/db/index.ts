import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl ?? "postgresql://127.0.0.1:5432/app_db",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

let schemaPromise: Promise<void> | undefined;

export function ensureDatabaseSchema() {
  if (!databaseUrl) {
    return Promise.reject(new Error("DATABASE_URL is not configured"));
  }
  schemaPromise ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_files (
        id serial PRIMARY KEY,
        name text NOT NULL,
        mime text NOT NULL DEFAULT 'application/octet-stream',
        size integer NOT NULL DEFAULT 0,
        checksum text NOT NULL,
        content text NOT NULL,
        version integer NOT NULL DEFAULT 1,
        primary_node text NOT NULL,
        replicas jsonb NOT NULL DEFAULT '[]'::jsonb,
        target_replicas integer NOT NULL DEFAULT 2,
        downloads integer NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mr_jobs (
        id serial PRIMARY KEY,
        job text NOT NULL,
        input_name text NOT NULL,
        input_bytes integer NOT NULL DEFAULT 0,
        mappers integer NOT NULL,
        reducers integer NOT NULL,
        combiner boolean NOT NULL DEFAULT false,
        duration_ms integer NOT NULL DEFAULT 0,
        summary jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
  })().catch((error) => {
    schemaPromise = undefined;
    throw error;
  });
  return schemaPromise;
}
