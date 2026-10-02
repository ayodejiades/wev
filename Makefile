# Makefile — real targets, called by the owner and by the KitBuilder pipeline.
# Track-specific recipes (dev/test/deploy) are appended below this line by the track
# template; everything else here is the same for every track.

.PHONY: dev test deploy demo-path record demo gif preflight keepalive prewarm

demo-path:
	@echo "regenerating docs/DEMO_PATH.md from docs/demo-path.json"
	@KIT_STARTER="$${KIT_STARTER:-/Users/mac/hackops/skills/hackathon-starter}"; \
	python3 "$$KIT_STARTER/scripts/gen.py" demo-path-md --in docs/demo-path.json --out docs/DEMO_PATH.md

record:
	@KIT_BIN="$${KIT_BIN:-/Users/mac/.local/bin}"; \
	"$$KIT_BIN/demo-record" . --demo-mode

demo:
	@KIT_BIN="$${KIT_BIN:-/Users/mac/.local/bin}"; \
	"$$KIT_BIN/demo-build" . 2>/dev/null || echo "demo-build not installed yet — built in Phase 3"

gif:
	@KIT_BIN="$${KIT_BIN:-/Users/mac/.local/bin}"; \
	"$$KIT_BIN/demo-build" . --gif 2>/dev/null || echo "demo-build not installed yet — built in Phase 3"

preflight:
	@KIT_STARTER="$${KIT_STARTER:-/Users/mac/hackops/skills/hackathon-starter}"; \
	bash "$$KIT_STARTER/scripts/preflight.sh" .

keepalive:
	@echo "keepalive workflow is at .github/workflows/keepalive.yml — enable it with:"
	@echo "  gh variable set DEPLOY_URL --body https://your-deploy-url"
	@echo "  gh workflow enable keepalive.yml"
dev:
	pnpm dev --port $${PORT:-3100}

test:
	pnpm test && pnpm verify:evidence

claim-verify:
	pnpm verify:evidence

# Applied against the real database before the app is published. Without this the
# deployed app 500s on every dashboard route, because the table the code reads was
# never created — see db/migrations/. Skipped when DATABASE_URL is unset, so a
# fixture-only demo deploy still works.
db-setup:
	@if [ -z "$$DATABASE_URL" ]; then \
		echo "db-setup: DATABASE_URL is not set — skipping (see .env.example)"; \
	else \
		echo "db-setup: applying migrations to the configured database"; \
		pnpm db:migrate; \
	fi

deploy: db-setup
	@if [ -n "$$CLOUDFLARE_API_TOKEN" ]; then \
		npx --yes wrangler pages deploy .next --project-name "$${CF_PROJECT_NAME:-$$(basename $$(pwd))}"; \
	else \
		npx --yes vercel --prod --yes; \
	fi
