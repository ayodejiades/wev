// db/index.ts — reads DATABASE_URL. In DEMO_MODE, reads/writes an in-memory store seeded
// from fixtures/ instead, so the vertical slice works with the Wi-Fi off.
import fs from "node:fs";
import path from "node:path";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isDemoMode } from "@/lib/demo-mode";
import { requireDatabaseUrl } from "@/lib/env";
import { records, type Record } from "./schema";

type Store = { records: Record[]; nextId: number };

let memoryStore: Store | null = null;

function loadFixtureStore(): Store {
  const fixturePath = path.join(process.cwd(), "fixtures", "records.json");
  const seed: Array<{ title: string; createdAt: string }> = JSON.parse(
    fs.readFileSync(fixturePath, "utf-8"),
  );
  const seeded = seed.map((row, i) => ({ id: i + 1, title: row.title, createdAt: new Date(row.createdAt) }));
  return { records: seeded, nextId: seeded.length + 1 };
}

function getMemoryStore(): Store {
  if (!memoryStore) memoryStore = loadFixtureStore();
  return memoryStore;
}

let sqlClient: ReturnType<typeof postgres> | null = null;
function getDrizzle() {
  if (!sqlClient) {
    sqlClient = postgres(requireDatabaseUrl(), { max: 5 });
  }
  return drizzle(sqlClient);
}

/**
 * probeDatabase — the deep check behind /api/health.
 *
 * DEMO_MODE=1: reports `demo` without touching a database, because the whole point of
 * demo mode is that it works with the Wi-Fi off.
 * DEMO_MODE=0: opens a real connection, runs `SELECT 1`, and confirms the tables this
 * app reads actually exist. A missing table is the failure that used to reach a judge
 * as a 500 on a data route, so it is reported here rather than discovered there.
 */
export async function probeDatabase(): Promise<{
  reachable: boolean;
  tablesPresent: boolean;
  detail: string;
  latencyMs: number;
}> {
  if (isDemoMode()) {
    const store = getMemoryStore();
    return {
      reachable: true,
      tablesPresent: true,
      detail: `demo mode — ${store.records.length} fixture rows, no database contacted`,
      latencyMs: 0,
    };
  }

  const started = Date.now();
  // requireDatabaseUrl() throws when DATABASE_URL is unset, so it is called inside the
  // try: a missing URL is a health finding to report, not a 500 on the health route.
  let sql: ReturnType<typeof postgres>;
  try {
    sql = postgres(requireDatabaseUrl(), { max: 1, connect_timeout: 5 });
  } catch (err) {
    return {
      reachable: false,
      tablesPresent: false,
      detail: (err as Error).message,
      latencyMs: Date.now() - started,
    };
  }
  try {
    await sql`SELECT 1`;
    // to_regclass returns NULL (not an error) when the table is absent, so a missing
    // migration surfaces as a clear message instead of "relation does not exist".
    const rows = await sql<{ present: boolean | null }[]>`
      SELECT to_regclass('public.records') IS NOT NULL AS present
    `;
    const present = Boolean(rows[0]?.present);
    return {
      reachable: true,
      tablesPresent: present,
      detail: present
        ? "connected; table 'records' present"
        : "connected but table 'records' is missing — run `pnpm db:migrate` against this database",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      reachable: false,
      tablesPresent: false,
      detail: (err as Error).message,
      latencyMs: Date.now() - started,
    };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

export async function listRecords(): Promise<Record[]> {
  if (isDemoMode()) {
    return [...getMemoryStore().records].sort((a, b) => +b.createdAt - +a.createdAt);
  }
  const db = getDrizzle();
  return db.select().from(records).orderBy(desc(records.createdAt));
}

export async function createRecord(title: string): Promise<Record> {
  if (isDemoMode()) {
    const store = getMemoryStore();
    const row: Record = { id: store.nextId++, title, createdAt: new Date() };
    store.records.push(row);
    return row;
  }
  const db = getDrizzle();
  const [row] = await db.insert(records).values({ title }).returning();
  return row;
}

export async function closeDatabase(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 2 }).catch(() => {});
    sqlClient = null;
  }
}
