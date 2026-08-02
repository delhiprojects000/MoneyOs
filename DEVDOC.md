# MoneyOS - Developer Documentation

Technical reference: architecture, auth model, data model, API surface, and deployment. For a feature overview, see [README.md](./README.md).

## Table of contents

- [Architecture overview](#architecture-overview)
- [Auth model (no Supabase Auth)](#auth-model-no-supabase-auth)
- [The shared edge function](#the-shared-edge-function)
- [Data model](#data-model)
- [Receipts (Oracle CDN, not Supabase Storage)](#receipts-oracle-cdn-not-supabase-storage)
- [Theming](#theming)
- [Frontend structure](#frontend-structure)
- [Environment variables](#environment-variables)
- [Local development](#local-development)
- [Deploying backend changes](#deploying-backend-changes)
- [Known constraints / gotchas](#known-constraints--gotchas)

## Architecture overview

```
┌──────────────────┐   HTTPS/JSON, Bearer JWT   ┌───────────────────────────┐
│  React SPA        │ ─────────────────────────▶ │  Shared edge-runtime      │
│ (Vite, on Vercel) │ ◀───────────────────────── │  (self-hosted, one process)│
└──────────────────┘                              └──────────┬────────────────┘
                                                     SERVICE_ROLE_KEY (bypasses RLS)
                                                                ▼
                                                   ┌─────────────────────────┐
                                                   │ Postgres (self-hosted)  │
                                                   │  moneyos schema, RLS deny-all │
                                                   └─────────────────────────┘
Receipts: browser ─▶ edge function ─▶ writes to /mnt/storage/public-cdn/images/moneyos/
Reads:    browser ─▶ https://mystorage.dileepadari.dev/images/moneyos/{file} (Caddy)
```

There is **no managed/paid Supabase project**. Everything runs on the user's own self-hosted Oracle Cloud VM (`mystorage.dileepadari.dev`) - Postgres + PostgREST + Kong + edge-runtime, the same stack the sibling `design-andhra-pradesh` project uses. `@supabase/supabase-js` isn't used at all here (unlike `portfolio`); the edge function talks to PostgREST with plain `fetch()`, since pulling in the full `@supabase/supabase-js` SDK would be unnecessary weight on a ~950Mi RAM shared container.

The frontend **never talks to Postgres/PostgREST directly** - every read/write goes through one shared edge function, over `fetch`, using a self-issued JWT.

## Auth model (no Supabase Auth)

No Supabase Auth (GoTrue) anywhere, matching `portfolio`/`workos-personal`/`design-andhra-pradesh`:

- **`moneyos.users`** - plain table (`id`, `email`, `username`, `password_hash` via bcrypt, `display_name`, `avatar_url`, `default_currency`). No `auth.*` schema dependency.
- **Hand-rolled JWT** - HS256 sign/verify via Web Crypto (`signJwt`/`verifyJwt` in `supabase/functions/moneyos/index.ts`). Payload `{ sub, username, iat, exp }`, 30-day TTL (longer than the other apps' 7 days - this is a daily-use personal tool, not a shared workspace). Secret is `MONEYOS_JWT_SECRET`, set only on the VM, distinct from every other app's secret.
- **Client-side token storage** - `src/lib/authToken.ts` (localStorage, key `moneyos_token`); `src/contexts/AuthContext.tsx` wraps sign-up/sign-in/sign-out.
- **No workspace/multi-tenancy layer.** Every table is scoped directly by `user_id` - there's no `workspace_members` equivalent, since group-expense splitting here only needs to record a reason/headcount/your-share, not real second accounts (see "Group expenses" in README).
- **Authorization lives in the edge function, not RLS.** The function holds `SERVICE_ROLE_KEY` and bypasses RLS entirely (a real Postgres `service_role` grant, same mechanism the managed-Supabase pattern uses - this self-hosted box has genuine `ANON_KEY`/`SERVICE_ROLE_KEY` JWTs signed with its shared `JWT_SECRET`). Every handler independently checks `user_id` ownership before touching a row. RLS is still enabled on every `moneyos.*` table as defense-in-depth (deny-all, zero policies) - it is **not** the enforcement mechanism.

## The shared edge function

**Important deployment detail**: the Oracle VM's `edge-runtime` container runs in single **main-service** mode (`command: start --main-service /home/deno/functions` in `~/supabase-prod/docker/docker-compose.yml`) - there is exactly **one** `index.ts` for the whole box, at `/mnt/storage/supabase/functions/index.ts`, handling every app's `/functions/v1/*` traffic (it already served `design-andhra-pradesh`'s `/upload` and `/hello` routes before MoneyOS existed). This is *not* the one-directory-per-function model `portfolio`/`workos-personal` use on real Supabase Cloud.

MoneyOS's own logic lives in a **separate module**, `moneyos-routes.ts`, imported by the shared `index.ts`:

```ts
import { moneyosRouter, moneyosCorsHeaders } from "./moneyos-routes.ts";
// in the Deno.serve handler, before anything else:
if (url.pathname === "/moneyos" || url.pathname.startsWith("/moneyos/")) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: moneyosCorsHeaders() });
  return await moneyosRouter(req, url.pathname.replace(/^.*\/moneyos/, "") || "/");
}
```

This repo's copy of that logic is `supabase/functions/moneyos/index.ts` - treat it as the source of truth, but remember the *deployed* file on the VM is `/mnt/storage/supabase/functions/moneyos-routes.ts`, sitting next to the shared `index.ts` which still contains `design-andhra-pradesh`'s unrelated code. **Never edit the shared `index.ts` casually** - it's live production for another app. See "Deploying backend changes" below for the exact procedure.

Routes (all under `/functions/v1/moneyos/*`, reached via Kong at `https://supabase.dileepadari.dev`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup`, `/auth/login` | bcrypt + JWT; signup also creates a default "Cash" wallet |
| GET/PATCH | `/auth/me` | profile read/update |
| POST | `/data` | generic CRUD gateway - `{ table, operation, id?, payload?, filters?, order?, limit? }` against `categories`, `payment_methods`, `accounts`, `recurring_rules`, `loans`, `budgets`, `goals`, `bills`, `attachments`. `transactions`/`loan_payments` are select-only here (writes need the dedicated routes below for balance math); `loans` is select/insert/delete-only here (updates need `PATCH /loans/:id`, below); `categories`/`payment_methods` reject update/delete on system-seeded rows (`is_system`/`user_id null`) with a 403 |
| GET/POST | `/transactions`, PATCH/DELETE `/transactions/:id` | balance-affecting - every create/update/delete calls `adjust_account_balance` (a Postgres RPC, see `0004_functions.sql`) to reverse/apply the account balance atomically |
| POST | `/accounts/transfer` | paired transaction between two accounts |
| POST | `/loans`, PATCH `/loans/:id`, GET `/loans/:id/schedule`, POST `/loans/:id/payments/:paymentId/pay` | create loan → generates the full amortization schedule server-side (reducing-balance method); `PATCH` regenerates only the *unpaid* tail of the schedule when principal/rate/tenure/EMI/start_date change (paid installments are untouched, since their transactions already happened); paying an installment posts a linked transaction and auto-closes the loan once every installment is paid, `PATCH` reopens it if tenure is extended past a closed loan |
| POST | `/recurring_rules/:id/post` | manual "mark this cycle paid" for a non-autopay subscription/recurring expense - posts one transaction for the rule's current `next_run_date` and advances the schedule by one interval. Body takes the `period` the caller means to settle; if the rule already moved past it the call 409s instead of posting the following cycle (this is what makes a double-click safe) |
| GET | `/credit-cards/statements?tz_offset=` | per-card billing cycle: statement date, period covered, due date, `statement_balance`/`amount_due` (the closed cycle) and `unbilled_spend` (charged since it closed, due next cycle) |
| POST | `/process-due?tz_offset=` | catch-up pass, called once per app load (no cron on the box) - posts transactions for any `auto_post` recurring rule whose `next_run_date` has arrived (capped at 24 cycles/rule per call), and pays autopay-enabled credit card **statements** on their due date (transfer from `autopay_account_id` to the card), keyed by `accounts.last_settled_statement` so one statement is paid exactly once |
| GET | `/reports/summary?range=day\|week\|month\|year\|custom&tz_offset=` | server-side aggregation: totals, category breakdown (uncategorised spend under the `uncategorized` key, never dropped), trend (day buckets, or month buckets past ~2 months, with quiet buckets zero-filled), net worth (balances − outstanding loan principal), budget-vs-actual |
| POST | `/upload` | receipt proxy - writes directly to `/home/deno/public-cdn/images/moneyos/{userId}-{fileName}` (no round-trip to a separate upload service, unlike `workos-personal`'s Oracle proxy, since this function *is* colocated on the same box) |

## Data model

Everything lives in a dedicated **`moneyos` Postgres schema** (not `public`) - chosen over a second database (PostgREST binds to one database per process; a second DB would mean a second PostgREST container permanently resident in RAM on an already memory-tight box) and over a `public`-schema table prefix (a schema gives clean names without touching `public`, at the cost of one `PGRST_DB_SCHEMAS` config change + a coordinated `rest`+`kong` restart, done once during initial deploy).

Core tables: `users`, `categories` (system defaults have `user_id null`), `payment_methods` (same null-default convention - seeded with Cash, all the common UPI apps, cards, bank transfer, etc.), `accounts`, `recurring_rules`, `loans` + `loan_payments` (amortization schedule), `transactions`, `budgets`, `goals`, `bills`, `attachments`, `activity_log`.

`transactions.amount` is always what actually hit the account. For a group expense (`is_group_expense = true`), that's *your share only* - `group_total_amount`/`group_participant_count`/`group_reason` are kept separately for reporting, never subtracted from the balance themselves.

**Credit cards** reuse the existing signed `current_balance` convention instead of a separate "amount owed" column: a `type = 'credit'` account starts at 0 and an expense against it drives `current_balance` negative through the normal transaction/`adjust_account_balance` path - "spend on credit cuts the card, not cash" falls out of the existing model for free. `0005_credit_cards_and_autopay.sql` adds the card's own terms on top of that: `credit_limit`, `autopay_enabled`, `autopay_account_id` (funding source), `autopay_last_run`.

**Statement cycles** (`0006_statement_cycles_and_recurring_periods.sql`) are the second half of that: a card has a `statement_day` that closes a cycle and a `due_day` by which the closed cycle must be paid (0005's single `billing_day` is renamed to `due_day` - that's what the UI was already collecting under it). Everything charged from the day after the previous statement day through the latest one is *this* statement; anything after it is unbilled and belongs to the next cycle even though the current bill is still outstanding. No new balance columns: the whole cycle is derived from `current_balance` plus the card's transactions since the cycle start (`summarizeCard` in the edge function), so there's nothing to keep in sync. `last_settled_statement` records which statement autopay paid, keyed by that statement's close date - the previous "same calendar month as `autopay_last_run`" check got cycles that straddle a month boundary wrong.

`recurring_rules.auto_post` already existed in `0001` but had no processing behind it until `/process-due`; `0005` adds `last_run_date` (*when* it last posted) and `0006` adds `last_posted_period` (*which cycle* it last posted, i.e. the `next_run_date` that was consumed) - that's what "Due for Aug 2026" / "Last paid for Jul 2026" and the double-post rejection are built on.

Full schema in `supabase/migrations/` (`0001_init_schema.sql`, `0002_rls_policies.sql`, `0003_seed_system_defaults.sql`, `0004_functions.sql`, `0005_credit_cards_and_autopay.sql`, `0006_statement_cycles_and_recurring_periods.sql`), applied via raw `psql` - there's no Supabase CLI link to a self-hosted instance.

### Dates, timezones, and the container clock

Every bucket the backend computes - "today", "this month", a statement cycle - is a **calendar date in the user's timezone**, but `occurred_at` is an absolute `timestamptz` and the edge-runtime container's clock is UTC. Clients send `tz_offset` (minutes east of UTC, `-new Date().getTimezoneOffset()`, 330 for IST) on anything date-bucketed, and the function converts through it explicitly (`localDate`/`instantFromLocal`). Without that, a 1am IST expense is stored as the previous UTC day: it fell out of "today" and out of the 1st of the month entirely, and landed on the wrong bar in the trend chart. Never compare `occurred_at` against a bare `YYYY-MM-DDT00:00:00` - that resolves in the *container's* zone.

## Receipts (Oracle CDN, not Supabase Storage)

Uploads write straight to the box's existing `/mnt/storage/public-cdn` volume (the same one Caddy already serves at `https://mystorage.dileepadari.dev/images/*` for `design-andhra-pradesh`), under an `images/moneyos/` subfolder. No new storage service, no new Caddy config - just a new subdirectory under an existing public route.

## Theming

`src/contexts/ThemeContext.tsx` - light/dark + 6 accent palettes (Emerald default, Ocean, Sunset, Violet, Rose, Slate) plus a custom hex picker, applied as CSS custom property overrides on `document.documentElement`. Unlike `workos-personal`'s version, this is **entirely localStorage-based** - there's no shared-workspace settings table to sync across devices, since MoneyOS has no workspace concept.

## Frontend structure

```
src/
  pages/            One file per route (route table in src/App.tsx)
  components/
    ui/             shadcn primitives (copied from portfolio, edit sparingly)
    transactions/   TransactionDialog (the one add/edit form for all 3 transaction types) + QuickAddButton
    layout/         AppShell (sidebar + mobile sheet nav)
  contexts/         AuthContext, ThemeContext
  hooks/
    useMoneyData.ts  All TanStack Query hooks - every mutation invalidates accounts/transactions/reports/loans together, since almost every write moves money
  lib/
    api.ts          The only place that calls fetch() against the edge function
    authToken.ts     JWT storage/decoding
    format.ts        Currency/date formatting helpers
supabase/
  functions/moneyos/  This app's edge function logic (see deployment note above)
  migrations/          Schema history
```

## Environment variables

### Frontend (Vite / Vercel)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Base URL for the edge function (`{url}/functions/v1/moneyos`) - no anon/publishable key needed, there's no Supabase JS client on the frontend |

### VM-only (never in Vercel)

| Variable | Purpose |
|---|---|
| `MONEYOS_JWT_SECRET` | Signs/verifies this app's own user JWTs - lives in `~/supabase-prod/docker/.env` on the VM |
| `SERVICE_ROLE_KEY` | The box's real PostgREST service-role JWT, used to bypass RLS |
| `POSTGREST_URL` | Internal Docker network URL to PostgREST (`http://rest:3000`) - not the public Kong hostname, for speed and to avoid an unnecessary TLS round trip |

## Local development

```sh
npm install
cp .env.example .env   # VITE_SUPABASE_URL already points at the live backend
npm run dev             # http://localhost:8081
```

```sh
npm run lint
npx tsc --noEmit
npm run build
npm run preview
```

There's no local backend - `.env.example` points straight at the deployed VM, same as how you'd develop against any hosted API.

## Deploying backend changes

This is genuinely shared production infrastructure (Nextcloud and other apps run alongside it on the same box), so every change here should be scoped narrowly and verified read-only first:

1. **Migrations**: write a new numbered file in `supabase/migrations/`, then apply via `psql` over SSH: `cat supabase/migrations/000X_*.sql | ssh ubuntu@mystorage.dileepadari.dev "docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"`. A migration that **renames or drops** a column (as `0006` does with `billing_day` → `due_day`) has to be applied and the edge function swapped in the same sitting - the deployed function references the old name until it's replaced.
2. **Edge function changes**: edit `supabase/functions/moneyos/index.ts` locally, then `scp` it to `/tmp/` on the VM, `sudo mv` it into place as `/mnt/storage/supabase/functions/moneyos-routes.ts`, and `docker compose restart edge-runtime` (a plain restart is enough - only the shared `index.ts` needs a `docker compose up -d --no-deps` if its own content changes, which it shouldn't for routine MoneyOS work).
3. **Never touch `/mnt/storage/supabase/functions/index.ts` directly** unless you're deliberately changing how it dispatches to `moneyos-routes.ts` - it's shared with `design-andhra-pradesh`. Back it up first (`cp index.ts index.ts.bak-$(date +%s)`) and diff before/after to confirm only the intended lines changed.
4. **New Postgres schema/grants**: if `PGRST_DB_SCHEMAS` or the `rest`/`kong` containers ever need touching again, restart `rest` first, then `kong` (Kong caches upstream DNS - restarting `rest` without restarting `kong` afterward causes `connect() failed: No route to host` on subsequent requests).
5. **Verify with curl** against the live endpoint before considering any change done - don't rely on the frontend alone to catch backend regressions.

## Known constraints / gotchas

- **No client-side Realtime.** The browser only ever holds MoneyOS's own JWT, never a Supabase-authenticated session - "live" updates come from TanStack Query refetch-on-focus/invalidation, not websockets.
- **RLS is not authorization.** Deny-all everywhere, purely defense-in-depth. All real access control is in the edge function - a new table needs its own `user_id` ownership check added by hand.
- **The Oracle VM is memory-tight** (~950Mi total, historically down to double-digit Mi free). Avoid adding new containers or heavy new npm dependencies to the shared edge function; prefer plain `fetch()`-based PostgREST calls over pulling in `@supabase/supabase-js`.
- **Recharts + a single-slice Pie chart** needs `paddingAngle={0}` when there's only one category - with `paddingAngle > 0` and exactly one data point, Recharts draws a degenerate sliver instead of a full ring (see `src/pages/Reports.tsx`).
- **EMI amortization uses the reducing-balance method** with the *last* installment forced to close exactly to a zero remaining balance (rounding otherwise accumulates a few paise of drift over a long tenure).
- **The reports summary must account for every rupee of expense.** Uncategorised spend goes under the `uncategorized` key rather than being skipped - it used to be dropped from `by_category` entirely, which quietly hid every card swipe and subscription posted without a category and made the donut add up to less than the "Expense" total printed above it.
- **No cron on the box.** `POST /process-due` (auto-post recurring rules + credit-card autopay) is called from `AppShell`'s mount effect once per app load instead of on a schedule - if the app isn't opened for a while, due cycles queue up and all post at once next time it is (capped at 24 iterations per rule so a very stale rule can't generate an unbounded backlog in one pass). This is a deliberate trade-off, not a bug - a real cron would need a new always-on process on an already memory-tight VM.
- **The 2-day-ahead reminder bell is entirely client-computed** (`NotificationsBell.tsx`), not a push/email notification - it re-derives "due within 2 days" from already-fetched bills/loans/recurring-rules/credit-account data on every render. There's no notification infrastructure (no service worker, no server-sent push) on this box.
