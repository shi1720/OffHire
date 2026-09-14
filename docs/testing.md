# Validation record

Validated on 14 September 2026: 67 behavior tests, 19 service integration regressions and 24 HTTP checks passed. The standalone reference has its own 79-test suite with overlapping core cases. Tests use fictional data and never dial a live number. Passing simulations do not prove carrier connectivity or a real supplier outcome.

| Layer | Command | What it verifies |
|---|---|---|
| Pure behavior | `npm run test:unit` | Billing/collection evidence, dates, identifier boundaries, contradictions, independent custody state, task scope and input validation |
| Service integration | `npm run test:integration` | Actual service, official SDK serialization and real SQLite migration/transactions against a closed fake transport |
| HTTP + D1 | `npm run test:smoke` with dev server running | Real route handlers and local D1 persistence, plan/approval/export/follow-through, isolation, validation and CSRF |
| Static/build | `npm run typecheck`, `npm run build` | TypeScript and complete Worker/client bundle |
| Dependencies | `npm audit --omit=dev` | Installed runtime dependency advisories; zero at the recorded validation |

The integration harness tests concurrent dispatch, same-job budget reservation, account capacity, accepted-but-lost create responses, same-body/key recovery, terminal races, expired grants, stale recovery, saved-ID GET without redial, unsigned callback refetch/deduplication, full history over 100 jobs, and reconciliation order. It blocks every network request outside its fake provider, rather than proxying any request to CALL-E.

Reproduce from a fresh clone with `npm ci && npm run setup`. The setup script builds and applies actual pending migrations locally. An independent empty local database and a second idempotent setup run were checked. An alternate `OFFHIRE_LOCAL_DB_DIR` is a setup-test override only; the dev server normally uses `.wrangler/state`.

Browser QA covered create-and-reload persistence, a 390-pixel mobile desk and plan dialog without horizontal overflow, plan execution, invoice review, and valid/invalid WebMCP selection. Unit tests do not stand in for UI inspection. Current test output is authoritative for counts. CI runs type checking, the two offline test layers, setup/build and an HTTP smoke run. It needs no secrets.

## Known unverified boundary

A real owned-number CALL-E test needs the project owner's API credential and explicit authorized destination. Preserve the actual Call ID, transcript and result after running it. Do not label synthetic receipts as live evidence or change the engine to force a successful demonstration. Broader supplier phrasing, long-running infrastructure failures, load/abuse resilience and production monitoring require pilot work.
