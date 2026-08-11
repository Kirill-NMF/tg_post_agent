import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type DatabaseConfig = {
  databaseUrl: string;
};

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv, options: { preferTest?: boolean } = {}): string | undefined {
  const primaryName = options.preferTest ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const fallbackName = options.preferTest ? "DATABASE_URL" : "TEST_DATABASE_URL";
  return readOptional(env, primaryName) ?? readOptional(env, fallbackName);
}

export function createDbPool(config: DatabaseConfig): pg.Pool {
  return new pg.Pool({ connectionString: config.databaseUrl });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type AppDb = ReturnType<typeof createDb>;

export async function closeDbPool(pool: pg.Pool): Promise<void> {
  await pool.end();
}

function readOptional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}
