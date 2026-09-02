# not_for_you.md

A personal working log. Not documentation, and nothing here is needed to use or contribute to MoneyOS. Everything a newcomer actually needs is in [README.md](./README.md) and [DEVDOC.md](./DEVDOC.md).

This is the dumping ground for small local decisions, oddities noticed while reading the code, and things to clean up later.

---

## Frontend

### `src/App.tsx`

- `staleTime` is 30s and `retry` is 1. Long enough that flipping between tabs does not re-fetch everything, short enough that a stale balance never sits on screen for long. Nothing measured, just what felt right.
- `RequireAuth` renders `AuthSkeleton` while `loading`, not `null`. Returning `null` flashed the login screen on every refresh before the `/auth/me` round trip finished.
- `<Toaster position="top-right" />` sits outside `BrowserRouter` on purpose so a toast survives navigation.

### `src/lib/format.ts`

- `currencyFormatters` is a `Map` cache because `Intl.NumberFormat` construction is genuinely slow and the transaction list formats hundreds of amounts per render.
- Locale is hardcoded `'en-IN'` for grouping (1,23,456 rather than 123,456), even when the currency is USD. Wrong in principle, right for who uses this. If a non-Indian user ever appears, this is the line to change.
- `formatRelativeDay` compares `toDateString()` values rather than doing date arithmetic. Slightly ugly, avoids a DST off-by-one.

### `src/lib/authToken.ts`

- Token key is `moneyos_token`. The sibling apps on the same host use their own prefixes, so several can be signed in at once in the same browser without colliding.

### `src/lib/utils.ts`

- `preventAccidentalDialogClose` exists because a stray Escape while typing an amount used to discard the whole form. Worth the two-line spread on every dialog with real input.

### `src/hooks/useMoneyData.ts`

- Invalidation is deliberately coarse: one helper invalidates five query keys. Fine-grained invalidation was tried and was not worth threading through every call site; the requests are small.
- `usePostRecurringRule` invalidates `recurring_rules` in `onError` as well as `onSuccess`. A 409 means the client's view was stale, so refetching is exactly the right response.
- `useUpdateAccount` separately invalidates `credit-card-statements` because editing a statement day changes the whole cycle without any transaction moving.

### `src/contexts/ThemeContext.tsx`

- Custom palette dark variants are lightness 62% and 58%. Picked by eye against the emerald palette until they matched; there is no formula behind those numbers.
- `applyColors` writes `--primary`, `--ring` and `--accent` but not their `-foreground` pairs, so a very light custom accent can produce low-contrast text on a primary button. Nobody has hit it. Worth deriving foregrounds from perceived lightness eventually.
- The `eslint-disable react-hooks/exhaustive-deps` on the theme effect is intentional: adding `applyColors` to the deps array would recreate it every render.

### `src/pages/Loans.tsx`

- The monthly-total estimate treats a week as 4.33 months-worth and a day as 30. Good enough for a "roughly this much a month" line, wrong if anyone ever treats it as exact.
- `posting` tracks a single row id rather than using the mutation's own `isPending`, because one shared mutation would disable every row's button at once.

### `src/pages/Settings.tsx`

- `downloadBlob` attaches the anchor to the DOM before clicking and revokes the object URL on a timeout. Both are needed: a detached anchor does not reliably fire in every browser, and revoking synchronously after `.click()` races the browser starting to read the blob.
- The page issues the same category and payment-method queries its child cards do. That is a cache read, not a re-fetch, and it lets the page show one skeleton instead of each card popping in separately.

### `src/pages/Reports.tsx`

- `PIE_COLORS` is a hand-picked ten. Categories beyond ten wrap around and repeat. Nobody has that many active categories yet.
- Uncategorised is pinned to `#94a3b8` so it never borrows a category's colour and looks like a real category.

---

## Backend

### JWT

- 30-day TTL was picked because re-authenticating a personal finance app weekly is friction with no matching benefit. If this ever became multi-user it should drop to hours with refresh tokens.
- `verifyJwt` checks `exp` after verifying the signature, not before. Slightly more work on an expired token, but it means an unsigned token can never influence control flow.

### PostgREST client

- `Prefer: return=representation` is set on every request including selects, where it does nothing. Harmless, and simpler than branching.
- `pg()` returns `null` for a 204 rather than throwing. Delete relies on that.
- There is no retry anywhere. A transient PostgREST failure surfaces as a toast and the user retries. Fine for one user; not fine at any real scale.

### Transactions

- `handleUpdateTransaction` reverses the old balance effect, patches, then applies the new one. Two RPC calls where one delta would do, but the intermediate state is never observable and the code reads in the order the reasoning goes.
- `applyBalanceEffect` takes `sign: 1 | -1` instead of separate apply and reverse functions, so the two can never drift.
- `clearCardSettlementMarkers` loops per target account and checks each is a credit card. With at most a handful of cards this is not worth batching.

### Loans

- `generateAmortizationSchedule` rounds to paise at each step and forces the final instalment to close the principal exactly, absorbing the accumulated drift. The alternative, distributing the rounding, produces uglier numbers on screen.
- The `i < tenureMonths` loop has a `break` when `remaining <= 0`, so an overlarge EMI simply closes the loan early rather than generating negative instalments.
- Loans without a category fall back to the seeded "EMI & Loans" system category, looked up by name. Renaming that row in a future seed would silently break the lookup. It is protected from user edits, but not from me.

### Recurring

- The catch-up iteration cap is 24. No reason beyond "two years of monthly rules is more than enough backlog for one pass".
- `advanceDate` defaults unknown frequencies to monthly rather than throwing. Defensive against a bad row; also means a typo in `frequency` would be silently wrong.
- `cyclePeriodLabel` exists in the backend and `formatCyclePeriod` in the frontend, doing the same thing in two languages. The backend one stamps the transaction description at post time; the frontend one labels rows that have not posted yet. Genuinely two uses, but they must be kept in step.

### Credit cards

- `statementDatesFor` uses `Number(todayStr.slice(8)) > statementDay` rather than `>=`, because on the statement day itself the cycle is still open.
- The 1-28 bound on both day columns is a database check constraint and a UI validation. It exists so no month-length logic is needed anywhere.
- `summarizeCard` is pure and takes today as a string. That was for testability, and then no tests were written. The shape is still right.
- `loadStatementCycles` builds an `or=(account_id.in.(...),transfer_to_account_id.in.(...))` from card ids. Those ids come from the database, not from a client, so interpolating them is safe. Worth remembering if that ever changes.

### Reports

- `buildTrend` caps at 400 buckets. A custom range longer than that silently truncates rather than erroring. Nobody has tried.
- Granularity flips from day to month at 62 days. Two months of daily bars is readable; three is not.
- `budgetVsActual` treats a budget with no category as being against total expense. That is not exposed in the UI, which always requires a category, so the branch is currently dead.

### Upload

- Receipts go straight to a shared filesystem volume, not to Supabase Storage, because the self-hosted stack on this box does not run the storage service.
- The filename regex allows `..`, but names are prefixed with the user id, so `..` cannot escape the directory. It works by accident of the prefix rather than by the check. Tightening the regex would be better.

---

## Schema

- Everything lives in a `moneyos` schema rather than `public` because the same Postgres instance carries other apps. Worth the extra `Accept-Profile` header on every request.
- `0006` renames `billing_day` to `due_day` and adds `statement_day`, because the original column held due days despite its name. The constraint rename is wrapped in a guarded `do $$` block: an autogenerated constraint name is not worth failing a migration over.
- `activity_log` was meant to be a full audit trail and only ever got wired into transaction creation. Either finish it or drop the table.
- `attachments` duplicates `transactions.attachment_url`. The table supports many receipts per transaction; the UI only ever sets the single column. One of the two should go.
- No down migrations anywhere. Rolling back means restoring a backup.

---

## Tooling

- The four ESLint warnings are all `react-refresh/only-export-components`, from contexts exporting both a provider and a hook. Splitting each into two files would silence them and make the imports worse. Left alone deliberately.
- `@tailwindcss/oxide-linux-x64-gnu` is pinned in `optionalDependencies` so CI on Linux does not have to resolve the native binary at install time.
- The build warns about a 965KB chunk on every run. Real, and on the enhancements list; the warning is noise until then.

---

## Demo and screenshots

- `scripts/seed-demo.mjs` seeds through the public API rather than SQL, so it exercises the same paths a user does. Slower, but it caught two real bugs while being written.
- The seeded demo account was registered through the app's own sign-up form, not inserted directly, for the same reason.
- Seed dates are relative to today, so re-running months later still produces a sensible spread.
- Instalment payments are back-dated after being posted, because the pay route stamps "now" (correct for a real payment, wrong for demo history).
- The Cash account needs special handling: sign-up auto-creates it at zero, so the seeder patches its opening balance instead of creating a second one. Without that, cash spending drives it negative and the accounts page shows a wallet that owes money.
- The GPay wallet opening balance was raised to 9,500 for the same reason after adding current-month transactions.
- Budgets are calendar-month scoped, so seeding on the 2nd of a month leaves every budget at zero unless some transactions land in the current month. That is why the seed has a deliberate current-month block.
- Screenshots were captured with the browser window at 1920 wide; `resize_window` did not take effect in that environment, so the responsive shots are iframes at 390 and 820 wide, which resolve media queries against the iframe viewport correctly.

---

## Open threads

- Decide whether `attachments` or `transactions.attachment_url` survives.
- Decide whether `activity_log` gets finished or dropped.
- Derive `--primary-foreground` from perceived lightness so a pale custom accent stays readable.
- Tighten the upload filename regex so directory safety does not depend on the id prefix.
