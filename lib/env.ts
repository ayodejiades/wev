// lib/env.ts — zod-validated environment.
//
// This used to throw at MODULE LOAD when DATABASE_URL was missing and DEMO_MODE was
// off. In Next that runs during `next build` when a page collects its data, so a
// freshly scaffolded project with no database yet could not build at all — and the
// failure surfaced as "Failed to collect page data for /login", naming the wrong file.
//
// Two changes:
//   1. `DEMO_MODE` is a plain flag with no dependency, so anything that only needs to
//      know whether it is in demo mode never touches the validated config below.
//   2. The DATABASE_URL requirement is enforced when the database is actually opened
//      (db/index.ts), where the error can name the real cause, rather than as a side
//      effect of importing a module.
import { z } from "zod";

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";

/** Whether DEMO_MODE is on. Safe to call at module scope — no validation, no throw. */
export function demoModeEnabled(): boolean {
  const flag = process.env.DEMO_MODE;
  if (flag !== undefined && flag !== "") return truthy(flag);
  // Nothing configured: run on the committed fixtures so a clone or a preview link works.
  return !process.env.DATABASE_URL;
}

const schema = z.object({
  DEMO_MODE: z
    .string()
    .optional()
    .default("0")
    .transform(truthy),
  DATABASE_URL: z.string().optional(),
  DEPLOY_URL: z.string().optional().default("http://localhost:3000"),
});

function loadEnv() {
  const parsed = schema.safeParse({
    DEMO_MODE: process.env.DEMO_MODE,
    DATABASE_URL: process.env.DATABASE_URL,
    DEPLOY_URL: process.env.DEPLOY_URL,
  });
  if (!parsed.success) {
    console.error("lib/env.ts: invalid environment", parsed.error.flatten().fieldErrors);
    throw new Error("invalid environment: see lib/env.ts");
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * The database connection string, or a loud failure naming the real fix. Called from
 * db/index.ts at the point of connection rather than at import time.
 */
export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) {
    throw new Error(
      "lib/env.ts: DATABASE_URL is not set. Copy .env.example to .env and paste your " +
        "Postgres URL, or run with DEMO_MODE=1 to use the offline fixtures. " +
        "Free database: https://neon.tech",
    );
  }
  return env.DATABASE_URL;
}
