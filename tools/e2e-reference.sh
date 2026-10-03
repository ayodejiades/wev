#!/usr/bin/env bash
# tools/e2e-reference.sh — run the browser tests against a build that HAS a
# reference-labels.json.
#
# Why a rebuild: the pages import evidence/*.json statically, so swapping files
# at runtime cannot change an already-built app. The only honest method is:
# write the fixture into evidence/, recalibrate, rebuild into a separate output
# dir, test that build, then put the repo back exactly as it was.
#
# The reference file here is a TEST FIXTURE (a deterministic function of
# data/items.json), not a real model run: it proves the reference-present UI
# path, and nothing it produces is committed.
set -euo pipefail

cd "$(dirname "$0")/.."

BK=$(mktemp -d)
cp -R evidence "$BK/evidence"
# next-env.d.ts is rewritten by every build to point at the build output dir, so a
# .next-e2e build would leave the committed file referencing a directory this
# script deletes. Back it up (and tsconfig.json, which Next may reformat).
cp next-env.d.ts "$BK/next-env.d.ts"
cp tsconfig.json "$BK/tsconfig.json"

restore() {
  # Restore first, then diff against the backup (the diff needs it), then delete.
  rm -rf evidence .next-e2e
  cp -R "$BK/evidence" evidence
  cp "$BK/next-env.d.ts" next-env.d.ts
  cp "$BK/tsconfig.json" tsconfig.json
  if ! diff -r "$BK/evidence" evidence >/dev/null; then
    echo "RESTORE FAILED: evidence/ differs from the backup" >&2
    rm -rf "$BK"
    exit 1
  fi
  rm -rf "$BK" .next-e2e
  # WHAT_IS_REAL.md and CLAIM_LEDGER.md are generated from evidence/: re-derive
  # them from the restored evidence so nothing claims a reference run that no
  # longer exists.
  pnpm claim:verify >/dev/null || echo "WARN: claim:verify after restore failed" >&2
  echo "e2e-reference: evidence/ restored, ledgers re-derived, .next-e2e removed"
}
trap restore EXIT

# 1. Materialise the fixture as evidence/reference-labels.json, computing the
#    items sha256 from the current data/items.json (never hardcoded).
node --import tsx tools/make-reference-fixture.ts

# 2. Recompute the evidence that depends on it.
pnpm calibrate
pnpm claim:verify

# 3. Build into a separate dir so the committed .next stays untouched.
#    BUILD_CMD exists because `next build` (Turbopack) intermittently livelocks
#    in the postcss worker on a heavily loaded machine; `next build --webpack`
#    produces the same app. Default stays the documented command.
NEXT_DIST_DIR=.next-e2e ${BUILD_CMD:-pnpm build}

# 4. Only the reference-tagged tests run in this build.
E2E_REFERENCE_FIXTURE=1 E2E_DIST_DIR=.next-e2e E2E_PORT="${E2E_PORT:-3113}" pnpm test:e2e