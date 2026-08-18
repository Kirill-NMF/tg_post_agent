import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDbPool, createDb, createDbPool, resolveDatabaseUrl } from "../../src/db/connection.js";

export type TestDatabaseHandle = {
  db: ReturnType<typeof createDb>;
  close(): Promise<void>;
  clean(): Promise<void>;
};

export async function openTestDatabase(env: NodeJS.ProcessEnv): Promise<TestDatabaseHandle | undefined> {
  const databaseUrl = resolveDatabaseUrl(env, { preferTest: true });
  if (!databaseUrl) return undefined;

  assertSafeTestDatabaseUrl(databaseUrl);

  const pool = createDbPool({ databaseUrl });
  const db = createDb(pool);
  await migrate(db, { migrationsFolder: "drizzle" });

  return {
    db,
    async close() {
      await closeDbPool(pool);
    },
    async clean() {
      assertSafeTestDatabaseUrl(databaseUrl);
      await db.execute(sql`
        truncate table custom_emoji_settings, artifacts, jobs, project_messages, project_posts, projects, users
        restart identity cascade
      `);
    }
  };
}

export function assertSafeTestDatabaseUrl(rawUrl: string): void {
  const databaseName = databaseNameFromUrl(rawUrl);
  if (!/(test|dev)/i.test(databaseName)) {
    throw new Error(`Refusing to clean database '${databaseName}'. TEST_DATABASE_URL must point at a test/dev database.`);
  }
}

function databaseNameFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const lastPathSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (lastPathSegment) return decodeURIComponent(lastPathSegment);
  } catch {
    // Fall through to a conservative raw-string check for unusual libpq connection strings.
  }
  return rawUrl;
}
