// tests/integration.test.mjs — the production path, against a real Postgres.
//
// tests/health.test.mjs sets DEMO_MODE=1, which routes every query to the in-memory
// fixture store. It therefore cannot detect a missing migration, a missing table, or a
// bad column — all of which only fail once DEMO_MODE=0 and a real database is in play.
// That is exactly how an empty db/migrations/ shipped for the lifetime of this template.
//
// This file is the counterpart. It REQUIRES DATABASE_URL and exits non-zero without it,
// rather than silently passing on fixtures, because a green run that never touched the
// database is the failure mode it exists to prevent.
//
// CI runs it after `pnpm db:migrate` against a throwaway Postgres. Locally:
//   createdb kit_test
//   DATABASE_URL=postgres://localhost/kit_test pnpm db:migrate
//   DATABASE_URL=postgres://localhost/kit_test pnpm test:integration
import assert from "node:assert/strict";
import { test } from "node:test";

if (!process.env.DATABASE_URL) {
  console.error(
    "tests/integration.test.mjs: DATABASE_URL is not set, so the production path is untested.\n" +
      "  cause: this test deliberately refuses to fall back to the fixture store\n" +
      "  fix: create a database, then run:\n" +
      "         DATABASE_URL=postgres://user:pass@localhost:5432/kit pnpm db:migrate\n" +
      "         DATABASE_URL=postgres://user:pass@localhost:5432/kit pnpm test:integration",
  );
  process.exit(1);
}

// DEMO_MODE=0 is the whole point: every query below must reach Postgres.
process.env.DEMO_MODE = "0";

test("the records table exists — the migration actually ran", async () => {
  const { probeDatabase } = await import("../db/index.ts");
  const probe = await probeDatabase();
  assert.equal(probe.reachable, true, `database unreachable: ${probe.detail}`);
  assert.equal(
    probe.tablesPresent,
    true,
    `table 'records' is missing — run: pnpm db:migrate (${probe.detail})`,
  );
  assert.ok(
    probe.detail.includes("records"),
    `detail should name the table it checked, got: ${probe.detail}`,
  );
});

test("createRecord persists and listRecords reads it back from Postgres", async () => {
  const { listRecords, createRecord } = await import("../db/index.ts");
  const before = await listRecords();
  const title = `integration-${Date.now()}`;

  const created = await createRecord(title);
  assert.equal(created.title, title, "createRecord must return the row it wrote");
  assert.ok(Number.isInteger(created.id), "a serial id must be assigned by the database");

  const after = await listRecords();
  assert.equal(after.length, before.length + 1, "the new row must be visible to a fresh read");
  assert.ok(
    after.some((r) => r.title === title),
    "the persisted row must be returned by listRecords",
  );
});

test("listRecords is ordered newest first", async () => {
  const { listRecords } = await import("../db/index.ts");
  const rows = await listRecords();
  assert.ok(rows.length > 0, "expected at least the row written by the previous test");
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      +rows[i - 1].createdAt >= +rows[i].createdAt,
      "rows must be ordered by createdAt descending",
    );
  }
});

test.after(async () => {
  const { closeDatabase } = await import("../db/index.ts");
  await closeDatabase();
});