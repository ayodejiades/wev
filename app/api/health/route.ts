// app/api/health/route.ts — the deployment's own report on whether it actually works.
//
// This endpoint used to return a hardcoded `{ ok: true }`, so `kit-autopilot`'s deploy
// and verify steps and `hack-preflight` check 6 all reported success on a completely
// broken app. It now really talks to the database. `ok` is false whenever the app
// could not serve a real request, and the status code says so.
//
//   GET /api/health          shallow: process liveness, no I/O, for uptime pings
//   GET /api/health?deep=1   deep: opens the database and confirms the tables exist
//
// `ok` is true in demo mode without any network call — that path is designed to work
// offline, so the honest answer there is "serving fixtures", which `demoMode` reports.
import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { probeDatabase } from "@/db";

// Never cache a health result: a stale "ok" from a warm CDN is the exact bug this fixes.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const base = {
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "dev",
    demoMode: isDemoMode(),
    checkedAt: new Date().toISOString(),
  };

  if (!deep) {
    return NextResponse.json(base, { headers: { "cache-control": "no-store" } });
  }

  const db = await probeDatabase();
  // In demo mode the fixtures are the product, so a healthy fixture store is `ok`.
  // Outside demo mode, an unreachable database or a missing migration is not.
  const ok = db.reachable && db.tablesPresent;

  return NextResponse.json(
    { ...base, ok, database: db },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
