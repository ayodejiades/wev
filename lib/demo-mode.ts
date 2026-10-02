// lib/demo-mode.ts — DEMO_MODE=1 replaces every external dependency (database, model API,
// third-party API) with on-disk fixtures, so the demo path completes with the Wi-Fi off.
//
// Reads the flag directly rather than through the validated config, so a page that only
// needs to know "am I in demo mode?" never triggers environment validation. That matters
// during `next build`, which evaluates this module for every route.
import { demoModeEnabled } from "./env";

export function isDemoMode(): boolean {
  return demoModeEnabled();
}
