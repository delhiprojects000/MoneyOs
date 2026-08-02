// MoneyOS backend routes.
//
// DEPLOYMENT NOTE: this file is written as a self-contained module, but the
// Oracle VM's edge-runtime container runs in single "main-service" mode
// (`command: start --main-service /home/deno/functions`, see
// docker-compose.yml) - ONE index.ts at
// /mnt/storage/supabase/functions/index.ts handles every /functions/v1/*
// request for every app on the box (it already serves design-andhra-pradesh's
// /upload and /hello routes). There is no per-directory-function deploy like
// portfolio/workos-personal use on real Supabase Cloud. So this file's
// `moneyosRouter` is spliced into that shared entrypoint behind an
// `if (url.pathname.startsWith("/moneyos/"))` branch - see
// DEVDOC.md "Deploying the backend" for the exact procedure. Treat this file
// as the source of truth for MoneyOS's own logic; the shared file on the VM
// additionally contains design-andhra-pradesh's unrelated /upload + /hello
// handlers, untouched.
//
// Auth: hand-rolled username/password + JWT (bcrypt + HS256 via Web Crypto),
// same shape as sibling portfolio/workos-personal apps - no Supabase Auth
// dependency. Unlike those two (which use a real managed Supabase project),
// this talks directly to the box's own PostgREST over the internal Docker
// network (http://rest:3000) using the genuine SERVICE_ROLE_KEY to bypass
// RLS, since supabase-js would be unnecessary bundle weight on a
// memory-constrained (~950Mi) shared container - plain fetch() against
// PostgREST's REST API is enough for what this needs.

import bcrypt from "npm:bcryptjs@2";

// --- Environment -----------------------------------------------------------

const POSTGREST_URL = Deno.env.get("POSTGREST_URL") ?? "http://rest:3000";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const MONEYOS_JWT_SECRET = Deno.env.get("MONEYOS_JWT_SECRET") ?? "";
const SCHEMA = "moneyos";
const JWT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days - daily-use personal tool, not a shared workspace

// --- JSON / CORS helpers ----------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...moneyosCorsHeaders() },
  });
}

export function moneyosCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, x-file-name",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
}

// --- Minimal HS256 JWT (sign + verify) via Web Crypto -----------------------
// Same hand-rolled scheme as portfolio/workos-personal's own edge functions.

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${encHeader}.${encPayload}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(MONEYOS_JWT_SECRET), new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSignature] = parts;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(MONEYOS_JWT_SECRET),
    base64UrlDecode(encSignature),
    new TextEncoder().encode(`${encHeader}.${encPayload}`),
  );
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encPayload)));
  if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

interface AuthedUser { sub: string; username: string }

async function requireAuth(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = await verifyJwt(token);
  if (!payload || typeof payload.sub !== "string") return null;
  return { sub: payload.sub, username: payload.username as string };
}

// --- PostgREST client (plain fetch, moneyos schema, service-role) ---------

class PostgrestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function pg(path: string, init: RequestInit & { single?: boolean; count?: boolean } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    "Content-Type": "application/json",
    Prefer: [init.single ? "return=representation" : "return=representation", init.count ? "count=exact" : ""].filter(Boolean).join(","),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.single) headers["Accept"] = "application/vnd.pgrst.object+json";

  const res = await fetch(`${POSTGREST_URL}${path}`, { ...init, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PostgrestError(body?.message || body?.error || `PostgREST error (${res.status})`, res.status);
  return body;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
};

// --- Local-calendar / timezone helpers -------------------------------------
// Every "day", "this month", "this statement cycle" bucket in this app is a
// calendar date in the *user's* timezone, but occurred_at is an absolute
// timestamptz and this container's clock is UTC. Without an explicit offset a
// 1am IST expense lands on the previous UTC day - it drops out of "today"
// entirely and shifts a day in the trend chart. Clients send `tz_offset` in
// minutes east of UTC (i.e. -new Date().getTimezoneOffset(), 330 for IST);
// everything below converts between instant and local calendar date through
// that offset instead of trusting the server's own zone.

function tzOffsetOf(params: URLSearchParams): number {
  const raw = Number(params.get("tz_offset"));
  return Number.isFinite(raw) && Math.abs(raw) <= 14 * 60 ? Math.trunc(raw) : 0;
}

/** Calendar date (YYYY-MM-DD) that an instant falls on in the user's timezone. */
function localDate(instant: string | Date, tzOffsetMin: number): string {
  const ms = (typeof instant === "string" ? new Date(instant) : instant).getTime();
  return new Date(ms + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

/** The absolute instant at which a local calendar date starts / ends. */
function instantFromLocal(dateStr: string, tzOffsetMin: number, edge: "start" | "end"): string {
  const base = Date.parse(`${dateStr}T00:00:00.000Z`) - tzOffsetMin * 60000;
  return new Date(edge === "end" ? base + 86_400_000 - 1 : base).toISOString();
}

function shiftDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Month arithmetic on a plain date string, clamping to the target month's length. */
function shiftMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** A given day-of-month within the same month as `dateStr` (clamped). */
function withDayOfMonth(dateStr: string, day: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

async function adjustAccountBalance(accountId: string, delta: number): Promise<number> {
  const result = await pg(`/rpc/adjust_account_balance`, {
    method: "POST",
    body: JSON.stringify({ p_account_id: accountId, p_delta: delta }),
  });
  return typeof result === "number" ? result : Array.isArray(result) ? result[0] : result;
}

// --- Auth routes -------------------------------------------------------

async function handleSignup(req: Request): Promise<Response> {
  const { email, username, password, display_name } = await req.json().catch(() => ({}));
  if (!email || !username || !password) return json({ error: "Missing email/username/password" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

  const existing = await pg(`/users${qs({ or: `(email.eq.${email},username.eq.${username})`, select: "id" })}`);
  if (Array.isArray(existing) && existing.length > 0) return json({ error: "Email or username already taken" }, 409);

  const password_hash = await bcrypt.hash(password, 10);
  const user = await pg(`/users`, {
    method: "POST",
    single: true,
    body: JSON.stringify({ email, username, password_hash, display_name: display_name || username }),
  });

  // A default "Cash" wallet so the dashboard isn't empty on first login.
  await pg(`/accounts`, {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, name: "Cash", type: "cash", icon: "banknote", color: "#16a34a" }),
  });

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ sub: user.id, username: user.username, iat: now, exp: now + JWT_TTL_SECONDS });
  return json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, default_currency: user.default_currency } });
}

async function handleLogin(req: Request): Promise<Response> {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return json({ error: "Missing username/password" }, 400);

  const rows = await pg(`/users${qs({ or: `(email.eq.${username},username.eq.${username})`, select: "id,username,password_hash,is_active,display_name,default_currency" })}`);
  const user = Array.isArray(rows) ? rows[0] : null;

  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return json({ error: "Invalid credentials" }, 401);
  }

  await pg(`/users${qs({ id: `eq.${user.id}` })}`, { method: "PATCH", body: JSON.stringify({ last_login_at: new Date().toISOString() }) });

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ sub: user.id, username: user.username, iat: now, exp: now + JWT_TTL_SECONDS });
  return json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, default_currency: user.default_currency } });
}

async function handleMe(req: Request, user: AuthedUser): Promise<Response> {
  const rows = await pg(`/users${qs({ id: `eq.${user.sub}`, select: "id,email,username,display_name,avatar_url,default_currency,created_at" })}`);
  const me = Array.isArray(rows) ? rows[0] : null;
  if (!me) return json({ error: "Not found" }, 404);
  return json({ user: me });
}

async function handleUpdateMe(req: Request, user: AuthedUser): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const key of ["display_name", "avatar_url", "default_currency"]) if (key in body) patch[key] = body[key];
  const updated = await pg(`/users${qs({ id: `eq.${user.sub}` })}`, { method: "PATCH", single: true, body: JSON.stringify(patch) });
  return json({ user: updated });
}

// --- Generic data gateway ------------------------------------------------
// Every table except transactions/loan_payments (which need server-side
// balance math / schedule linkage - see dedicated routes below).

const DATA_TABLES = new Set(["categories", "payment_methods", "accounts", "recurring_rules", "loans", "budgets", "goals", "bills", "attachments"]);
// System-seeded rows (user_id null) are shared defaults - a user can see
// them but never rename/delete the global "Food"/"Google Pay"/etc entries.
const SYSTEM_PROTECTED_TABLES = new Set(["categories", "payment_methods"]);

async function handleData(req: Request, user: AuthedUser): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { table, operation, id, idColumn = "id", payload, filters, order, limit } = body;

  if (table === "transactions" || table === "loan_payments") {
    if (operation !== "select") return json({ error: `Writes to ${table} must go through its dedicated endpoint` }, 400);
  } else if (table === "loans" && operation === "update") {
    return json({ error: "Loan edits must go through PATCH /loans/:id (schedule regeneration)" }, 400);
  } else if (!DATA_TABLES.has(table)) {
    return json({ error: "Table not allowed" }, 400);
  }

  if (SYSTEM_PROTECTED_TABLES.has(table) && (operation === "update" || operation === "delete")) {
    if (!id) return json({ error: "Missing id" }, 400);
    const rows = await pg(`/${table}${qs({ id: `eq.${id}`, select: "is_system,user_id" })}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json({ error: "Not found" }, 404);
    if (row.is_system || row.user_id === null) return json({ error: "System defaults can't be edited or deleted" }, 403);
  }

  if (operation === "select") {
    const params: Record<string, string> = { select: "*" };
    // user_id null rows are system defaults (categories/payment_methods) -
    // every user should see their own rows plus the shared system ones.
    params["or"] = `(user_id.eq.${user.sub},user_id.is.null)`;
    if (filters && typeof filters === "object") {
      for (const [k, v] of Object.entries(filters)) params[k] = typeof v === "string" && /^(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\./.test(v) ? v : `eq.${v}`;
    }
    if (order) params["order"] = order;
    if (limit) params["limit"] = String(limit);
    const data = await pg(`/${table}${qs(params)}`);
    return json({ data });
  }

  const stamp = (row: Record<string, unknown>) => ({ ...row, user_id: user.sub });

  if (operation === "insert") {
    const rows = Array.isArray(payload) ? payload.map(stamp) : stamp(payload);
    const data = await pg(`/${table}`, { method: "POST", single: !Array.isArray(payload), body: JSON.stringify(rows) });
    return json({ data });
  }

  if (operation === "update") {
    if (!id) return json({ error: "Missing id" }, 400);
    const data = await pg(`/${table}${qs({ [idColumn]: `eq.${id}`, user_id: `eq.${user.sub}` })}`, { method: "PATCH", single: true, body: JSON.stringify(payload) });
    return json({ data });
  }

  if (operation === "delete") {
    if (!id) return json({ error: "Missing id" }, 400);
    await pg(`/${table}${qs({ [idColumn]: `eq.${id}`, user_id: `eq.${user.sub}` })}`, { method: "DELETE" });
    return json({ success: true });
  }

  return json({ error: "Unknown operation" }, 400);
}

// --- Transactions (balance-affecting) --------------------------------------

interface TxRow {
  id: string; user_id: string; account_id: string; transfer_to_account_id: string | null;
  type: "expense" | "income" | "transfer"; amount: string;
}

async function applyBalanceEffect(tx: TxRow, sign: 1 | -1) {
  const amount = Number(tx.amount);
  if (tx.type === "expense") await adjustAccountBalance(tx.account_id, -amount * sign);
  else if (tx.type === "income") await adjustAccountBalance(tx.account_id, amount * sign);
  else if (tx.type === "transfer") {
    await adjustAccountBalance(tx.account_id, -amount * sign);
    if (tx.transfer_to_account_id) await adjustAccountBalance(tx.transfer_to_account_id, amount * sign);
  }
}

// A transfer into a credit card is a bill payment. If one is deleted or
// edited, whatever autopay recorded as "this statement is settled" may no
// longer be true, so the markers are cleared and the card becomes eligible to
// be flagged (and autopaid) again.
async function clearCardSettlementMarkers(txs: TxRow[]) {
  const targets = [...new Set(txs.filter((t) => t.type === "transfer" && t.transfer_to_account_id).map((t) => t.transfer_to_account_id!))];
  for (const accountId of targets) {
    const rows = await pg(`/accounts${qs({ id: `eq.${accountId}`, type: "eq.credit", select: "id" })}`);
    if (!Array.isArray(rows) || rows.length === 0) continue;
    await pg(`/accounts${qs({ id: `eq.${accountId}` })}`, {
      method: "PATCH",
      body: JSON.stringify({ autopay_last_run: null, last_settled_statement: null }),
    });
  }
}

async function handleCreateTransaction(req: Request, user: AuthedUser): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const {
    account_id, transfer_to_account_id, category_id, payment_method_id, type = "expense",
    amount, currency, description, notes, tags, occurred_at, is_group_expense,
    group_reason, group_total_amount, group_participant_count,
  } = body;

  if (!account_id || amount === undefined) return json({ error: "Missing account_id/amount" }, 400);
  if (type === "transfer" && !transfer_to_account_id) return json({ error: "Missing transfer_to_account_id" }, 400);

  const row: Record<string, unknown> = {
    user_id: user.sub, account_id, transfer_to_account_id: type === "transfer" ? transfer_to_account_id : null,
    category_id: category_id || null, payment_method_id: payment_method_id || null,
    type, amount, currency: currency || "INR", description: description || "", notes: notes || null,
    tags: tags || [], occurred_at: occurred_at || new Date().toISOString(),
    is_group_expense: !!is_group_expense,
    group_reason: is_group_expense ? group_reason ?? null : null,
    group_total_amount: is_group_expense ? group_total_amount ?? null : null,
    group_participant_count: is_group_expense ? group_participant_count ?? null : null,
  };

  const created = await pg(`/transactions`, { method: "POST", single: true, body: JSON.stringify(row) });
  await applyBalanceEffect(created as TxRow, 1);
  await pg(`/activity_log`, { method: "POST", body: JSON.stringify({ user_id: user.sub, action: "created", entity_type: "transaction", entity_id: created.id }) });
  return json({ data: created });
}

async function handleUpdateTransaction(req: Request, id: string, user: AuthedUser): Promise<Response> {
  const patch = await req.json().catch(() => ({}));

  const existingRows = await pg(`/transactions${qs({ id: `eq.${id}`, user_id: `eq.${user.sub}` })}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!existing) return json({ error: "Not found" }, 404);

  await applyBalanceEffect(existing as TxRow, -1); // reverse old effect

  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  delete merged.id;
  delete merged.created_at;
  const updated = await pg(`/transactions${qs({ id: `eq.${id}` })}`, { method: "PATCH", single: true, body: JSON.stringify(merged) });

  await applyBalanceEffect(updated as TxRow, 1); // apply new effect
  // Same reasoning as the delete path: editing a payment into a credit card
  // changes how much of that statement is actually settled.
  await clearCardSettlementMarkers([existing as TxRow, updated as TxRow]);
  return json({ data: updated });
}

async function handleDeleteTransaction(id: string, user: AuthedUser): Promise<Response> {
  const existingRows = await pg(`/transactions${qs({ id: `eq.${id}`, user_id: `eq.${user.sub}` })}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!existing) return json({ error: "Not found" }, 404);

  await applyBalanceEffect(existing as TxRow, -1);

  // Deleting a payment made *into* a credit card (autopay-generated or a
  // manual transfer) undoes that settlement - clear the settlement markers so
  // the card is eligible to be flagged as due again instead of silently
  // staying "already settled this cycle" even though the balance now shows
  // it owed.
  await clearCardSettlementMarkers([existing as TxRow]);

  await pg(`/transactions${qs({ id: `eq.${id}` })}`, { method: "DELETE" });
  return json({ success: true });
}

async function handleListTransactions(req: Request, user: AuthedUser): Promise<Response> {
  const url = new URL(req.url);
  const p = url.searchParams;
  const params: Record<string, string> = { select: "*", user_id: `eq.${user.sub}`, order: "occurred_at.desc" };
  if (p.get("from")) params["occurred_at"] = `gte.${p.get("from")}`;
  if (p.get("to")) params["occurred_at"] = params["occurred_at"] ? params["occurred_at"] : `lte.${p.get("to")}`;
  if (p.get("account_id")) params["account_id"] = `eq.${p.get("account_id")}`;
  if (p.get("category_id")) params["category_id"] = `eq.${p.get("category_id")}`;
  if (p.get("type")) params["type"] = `eq.${p.get("type")}`;
  if (p.get("search")) params["description"] = `ilike.*${p.get("search")}*`;
  if (p.get("limit")) params["limit"] = p.get("limit")!;

  // and= lets both from/to bounds coexist (both would otherwise collide as
  // the same "occurred_at" query-string key).
  let extra = "";
  if (p.get("from") && p.get("to")) {
    delete params["occurred_at"];
    extra = `&and=(occurred_at.gte.${p.get("from")},occurred_at.lte.${p.get("to")})`;
  }

  const data = await pg(`/transactions${qs(params)}${extra}`);
  return json({ data });
}

// --- Account transfer (paired transaction convenience route) ---------------

async function handleTransfer(req: Request, user: AuthedUser): Promise<Response> {
  const { from_account_id, to_account_id, amount, description, occurred_at } = await req.json().catch(() => ({}));
  if (!from_account_id || !to_account_id || !amount) return json({ error: "Missing from_account_id/to_account_id/amount" }, 400);

  const row = {
    user_id: user.sub, account_id: from_account_id, transfer_to_account_id: to_account_id,
    type: "transfer", amount, description: description || "Transfer", occurred_at: occurred_at || new Date().toISOString(),
  };
  const created = await pg(`/transactions`, { method: "POST", single: true, body: JSON.stringify(row) });
  await applyBalanceEffect(created as TxRow, 1);
  return json({ data: created });
}

// --- Loans / EMI -------------------------------------------------------

function generateAmortizationSchedule(principal: number, annualRatePct: number, tenureMonths: number, emiAmount: number, startDate: string) {
  const monthlyRate = annualRatePct / 12 / 100;
  const schedule: Array<{ installment_number: number; due_date: string; principal_component: number; interest_component: number; remaining_balance: number }> = [];
  let remaining = principal;
  const start = new Date(startDate);

  for (let i = 1; i <= tenureMonths; i++) {
    const interest = Math.round(remaining * monthlyRate * 100) / 100;
    let principalComp = Math.round((emiAmount - interest) * 100) / 100;
    if (i === tenureMonths || principalComp > remaining) principalComp = remaining; // last installment closes exactly
    remaining = Math.round((remaining - principalComp) * 100) / 100;

    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      installment_number: i,
      due_date: dueDate.toISOString().slice(0, 10),
      principal_component: principalComp,
      interest_component: interest,
      remaining_balance: Math.max(remaining, 0),
    });
    if (remaining <= 0) break;
  }
  return schedule;
}

// Loans created without an explicit category default to the seeded "EMI &
// Loans" system category, so installment payments actually show up in
// category-based reporting (pie chart, budget-vs-actual) instead of being
// invisible there.
async function defaultLoanCategoryId(): Promise<string | null> {
  const rows = await pg(`/categories${qs({ name: "eq.EMI & Loans", "user_id": "is.null", select: "id", limit: "1" })}`);
  return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
}

async function handleCreateLoan(req: Request, user: AuthedUser): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { name, lender_name, principal_amount, interest_rate = 0, tenure_months, emi_amount, start_date, account_id, category_id, notes } = body;
  if (!name || !principal_amount || !tenure_months || !emi_amount || !start_date || !account_id) {
    return json({ error: "Missing required loan fields" }, 400);
  }

  const resolvedCategoryId = category_id || await defaultLoanCategoryId();

  const loan = await pg(`/loans`, {
    method: "POST", single: true,
    body: JSON.stringify({ user_id: user.sub, name, lender_name: lender_name || null, principal_amount, interest_rate, tenure_months, emi_amount, start_date, account_id, category_id: resolvedCategoryId, notes: notes || null }),
  });

  const schedule = generateAmortizationSchedule(Number(principal_amount), Number(interest_rate), Number(tenure_months), Number(emi_amount), start_date);
  const rows = schedule.map((s) => ({ ...s, loan_id: loan.id, user_id: user.sub }));
  await pg(`/loan_payments`, { method: "POST", body: JSON.stringify(rows) });

  return json({ data: loan, schedule });
}

// Editing a loan can mean two very different things: fixing metadata
// (name/lender/notes - no schedule impact) or fixing the numbers themselves
// (wrong tenure/EMI/rate/principal/start date). For the latter, regenerate
// only the *unpaid* tail of the schedule so already-paid installments stay
// exactly as they were (their transactions already happened) - the new
// tenure/EMI/rate applies from the next unpaid installment onward, based on
// whatever principal remains after paid installments.
const SCHEDULE_AFFECTING_FIELDS = ["principal_amount", "interest_rate", "tenure_months", "emi_amount", "start_date"];

async function handleUpdateLoan(req: Request, loanId: string, user: AuthedUser): Promise<Response> {
  const patch = await req.json().catch(() => ({}));

  const loanRows = await pg(`/loans${qs({ id: `eq.${loanId}`, user_id: `eq.${user.sub}` })}`);
  const existing = Array.isArray(loanRows) ? loanRows[0] : null;
  if (!existing) return json({ error: "Not found" }, 404);

  const allPayments = await pg(`/loan_payments${qs({ loan_id: `eq.${loanId}`, select: "*", order: "installment_number.asc" })}`);
  const paid = (allPayments as Array<{ status: string; installment_number: number; due_date: string; remaining_balance: string }>).filter((p) => p.status === "paid");
  const lastPaid = paid[paid.length - 1];

  // Once any installment is paid, the schedule is permanently anchored to
  // that installment's due date (below) - the original start_date no longer
  // has any effect on it, so accepting a new value here would just leave a
  // fake "start date" on the loan that misrepresents its real schedule.
  if (lastPaid && "start_date" in patch) delete patch.start_date;

  const scheduleAffected = SCHEDULE_AFFECTING_FIELDS.some((f) => f in patch && String(patch[f]) !== String(existing[f]));

  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  delete merged.id;
  delete merged.created_at;
  const updated = await pg(`/loans${qs({ id: `eq.${loanId}` })}`, { method: "PATCH", single: true, body: JSON.stringify(merged) });

  let schedule: unknown = undefined;
  if (scheduleAffected) {
    const remainingPrincipal = lastPaid ? Number(lastPaid.remaining_balance) : Number(updated.principal_amount);
    const remainingTenure = Number(updated.tenure_months) - paid.length;
    const scheduleStartDate = lastPaid ? lastPaid.due_date : updated.start_date;

    if (remainingTenure <= 0) return json({ error: "New tenure must leave at least one installment after what's already paid" }, 400);

    // Delete only unpaid installments before regenerating - paid ones are untouched.
    await pg(`/loan_payments${qs({ loan_id: `eq.${loanId}`, status: `neq.paid` })}`, { method: "DELETE" });

    const regenerated = generateAmortizationSchedule(remainingPrincipal, Number(updated.interest_rate), remainingTenure, Number(updated.emi_amount), scheduleStartDate);
    const rows = regenerated.map((s) => ({ ...s, installment_number: s.installment_number + paid.length, loan_id: loanId, user_id: user.sub }));
    schedule = await pg(`/loan_payments`, { method: "POST", body: JSON.stringify(rows) });

    // Reopen a loan whose tenure was extended past what was previously closed.
    if (updated.status === "closed") await pg(`/loans${qs({ id: `eq.${loanId}` })}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
  }

  return json({ data: updated, ...(schedule ? { schedule } : {}) });
}

async function handleLoanSchedule(loanId: string, user: AuthedUser): Promise<Response> {
  const data = await pg(`/loan_payments${qs({ loan_id: `eq.${loanId}`, user_id: `eq.${user.sub}`, select: "*", order: "installment_number.asc" })}`);
  return json({ data });
}

async function handlePayLoanInstallment(req: Request, loanId: string, paymentId: string, user: AuthedUser): Promise<Response> {
  const paymentRows = await pg(`/loan_payments${qs({ id: `eq.${paymentId}`, loan_id: `eq.${loanId}`, user_id: `eq.${user.sub}` })}`);
  const payment = Array.isArray(paymentRows) ? paymentRows[0] : null;
  if (!payment) return json({ error: "Not found" }, 404);
  if (payment.status === "paid") return json({ error: "Already paid" }, 409);

  const loanRows = await pg(`/loans${qs({ id: `eq.${loanId}`, user_id: `eq.${user.sub}` })}`);
  const loan = Array.isArray(loanRows) ? loanRows[0] : null;
  if (!loan) return json({ error: "Loan not found" }, 404);

  const amount = Number(payment.principal_component) + Number(payment.interest_component);
  const tx = await pg(`/transactions`, {
    method: "POST", single: true,
    body: JSON.stringify({
      user_id: user.sub, account_id: loan.account_id, category_id: loan.category_id, type: "expense",
      amount, description: `${loan.name} - EMI ${payment.installment_number}/${loan.tenure_months}`,
      occurred_at: new Date().toISOString(),
    }),
  });
  await applyBalanceEffect(tx as TxRow, 1);

  const updatedPayment = await pg(`/loan_payments${qs({ id: `eq.${paymentId}` })}`, {
    method: "PATCH", single: true,
    body: JSON.stringify({ status: "paid", paid_date: new Date().toISOString().slice(0, 10), transaction_id: tx.id }),
  });

  const remaining = await pg(`/loan_payments${qs({ loan_id: `eq.${loanId}`, status: "neq.paid", select: "id", limit: "1" })}`);
  if (Array.isArray(remaining) && remaining.length === 0) {
    await pg(`/loans${qs({ id: `eq.${loanId}` })}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
  }

  return json({ data: updatedPayment, transaction: tx });
}

// --- Recurring rules: post a cycle + auto-process due ones ------------------

function advanceDate(dateStr: string, frequency: string, intervalCount: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + intervalCount);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7 * intervalCount);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + intervalCount);
  else d.setUTCMonth(d.getUTCMonth() + intervalCount); // monthly (default)
  return d.toISOString().slice(0, 10);
}

interface RecurringRuleRow {
  id: string; account_id: string; category_id: string | null; payment_method_id: string | null;
  type: "expense" | "income" | "transfer"; amount: string; currency: string; name: string;
  frequency: string; interval_count: number; next_run_date: string; end_date: string | null;
  last_posted_period: string | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Which period a cycle covers, in the terms the user thinks in: a monthly
// rent rule due 2026-08-05 is "August's rent", not "the 5 Aug run". Stamped
// into the posted transaction's description so the ledger says which month
// a payment settled - the whole point of the "for which month" column.
export function cyclePeriodLabel(frequency: string, cycleDate: string): string {
  const [y, m, d] = cycleDate.split("-").map(Number);
  if (frequency === "yearly") return String(y);
  if (frequency === "monthly") return `${MONTH_NAMES[m - 1]} ${y}`;
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

async function postRecurringCycle(rule: RecurringRuleRow, user: AuthedUser, occurredAt: string, cycleDate: string) {
  const tx = await pg(`/transactions`, {
    method: "POST", single: true,
    body: JSON.stringify({
      user_id: user.sub, account_id: rule.account_id, category_id: rule.category_id,
      payment_method_id: rule.payment_method_id, type: rule.type, amount: rule.amount,
      currency: rule.currency, description: `${rule.name} - ${cyclePeriodLabel(rule.frequency, cycleDate)}`,
      occurred_at: occurredAt, recurring_rule_id: rule.id,
    }),
  });
  await applyBalanceEffect(tx as TxRow, 1);
  return tx;
}

// Manual "mark this cycle paid" for a subscription/recurring expense that
// isn't flagged auto_post - posts one transaction for the *current* cycle
// (whatever next_run_date currently is, even if the user is doing this
// early or a bit late) and advances the schedule by one interval.
//
// The client sends the `period` (the next_run_date it was showing) it means
// to settle. A second click - on a row that hasn't re-rendered yet, or a
// double-submit - still carries the *old* period, which no longer matches
// the already-advanced rule, so it's rejected instead of quietly posting the
// following month too. Omitting `period` keeps the old blind behaviour for
// any caller that doesn't know about it.
async function handlePostRecurringRule(req: Request, ruleId: string, user: AuthedUser): Promise<Response> {
  const { period } = await req.json().catch(() => ({}));

  const rows = await pg(`/recurring_rules${qs({ id: `eq.${ruleId}`, user_id: `eq.${user.sub}` })}`);
  const rule = Array.isArray(rows) ? (rows[0] as RecurringRuleRow) : null;
  if (!rule) return json({ error: "Not found" }, 404);

  if (period && period !== rule.next_run_date) {
    const already = rule.last_posted_period === period;
    return json({
      error: already
        ? `${rule.name} is already marked paid for ${cyclePeriodLabel(rule.frequency, period)}.`
        : `This cycle moved on - ${rule.name} is now due for ${cyclePeriodLabel(rule.frequency, rule.next_run_date)}. Refresh and try again.`,
    }, 409);
  }

  const cycleDate = rule.next_run_date;
  const tx = await postRecurringCycle(rule, user, new Date().toISOString(), cycleDate);
  const nextRunDate = advanceDate(cycleDate, rule.frequency, rule.interval_count);
  const updatedRule = await pg(`/recurring_rules${qs({ id: `eq.${ruleId}` })}`, {
    method: "PATCH", single: true,
    body: JSON.stringify({
      next_run_date: nextRunDate,
      last_run_date: new Date().toISOString().slice(0, 10),
      last_posted_period: cycleDate,
    }),
  });

  return json({ data: updatedRule, transaction: tx });
}

// --- Credit card statement cycles ------------------------------------------
// A card has two dates, not one: the *statement (billing) day* that closes a
// cycle, and the *due day* by which that closed cycle has to be paid.
// Everything charged from the day after the previous statement day up to and
// including the latest one is this statement; anything swiped after it is
// unbilled and rolls into next month's statement, even though the current
// bill hasn't been paid yet. That distinction is the whole point - the old
// model billed the entire outstanding balance on one day, so a purchase made
// the day after the statement closed was demanded a fortnight early.
//
// Cards with no statement_day set fall back to "everything outstanding is
// billed", i.e. exactly what this did before cycles existed.

interface CreditAccountRow {
  id: string; name: string; currency: string; current_balance: string; credit_limit: string | null;
  autopay_enabled: boolean; autopay_account_id: string | null;
  statement_day: number | null; due_day: number | null;
  autopay_last_run: string | null; last_settled_statement: string | null;
}

interface CardTxRow {
  account_id: string; transfer_to_account_id: string | null;
  type: "expense" | "income" | "transfer"; amount: string; occurred_at: string;
}

interface StatementCycle {
  account_id: string; name: string; currency: string;
  statement_day: number | null; due_day: number | null;
  period_start: string | null; statement_date: string | null; due_date: string | null;
  next_statement_date: string | null; next_due_date: string | null;
  statement_balance: number; amount_due: number; cycle_spend: number;
  unbilled_spend: number; paid_since_statement: number;
  current_balance: number; credit_limit: number | null; owed: number;
  autopay_enabled: boolean; settled: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The cycle a card is currently in: last close, the period it covers, and when it's due. */
function statementDatesFor(statementDay: number, dueDay: number | null, todayStr: string) {
  // On the statement day itself the cycle is still open - it closes at the
  // end of that day, so only a *later* date sees this month's statement.
  const anchor = Number(todayStr.slice(8)) > statementDay ? todayStr : shiftMonths(todayStr, -1);
  const statementDate = withDayOfMonth(anchor, statementDay);
  const periodStart = shiftDays(withDayOfMonth(shiftMonths(anchor, -1), statementDay), 1);
  // A due day *after* the statement day falls in the same month as the
  // statement; a due day on or before it means the bill is due next month.
  const dd = dueDay ?? statementDay;
  const dueDate = dd > statementDay ? withDayOfMonth(statementDate, dd) : withDayOfMonth(shiftMonths(statementDate, 1), dd);
  return { statementDate, periodStart, dueDate };
}

/** Signed effect a transaction had on this card's balance (negative = charged). */
function cardDelta(tx: CardTxRow, cardId: string): number {
  const amt = Number(tx.amount);
  if (tx.transfer_to_account_id === cardId) return amt; // a payment into the card
  if (tx.account_id !== cardId) return 0;
  return tx.type === "income" ? amt : -amt; // refund/cashback vs charge or transfer out
}

function summarizeCard(card: CreditAccountRow, txs: CardTxRow[], tzOffsetMin: number, todayStr: string): StatementCycle {
  const currentBalance = Number(card.current_balance);
  const base = {
    account_id: card.id, name: card.name, currency: card.currency,
    statement_day: card.statement_day, due_day: card.due_day,
    current_balance: currentBalance, credit_limit: card.credit_limit === null ? null : Number(card.credit_limit),
    owed: round2(Math.max(0, -currentBalance)),
    autopay_enabled: card.autopay_enabled,
  };

  if (!card.statement_day) {
    // No statement day known - the whole outstanding balance is treated as
    // billed, due on the card's due day this month (the pre-cycle behaviour).
    const owed = round2(Math.max(0, -currentBalance));
    return {
      ...base,
      period_start: null, statement_date: null,
      due_date: card.due_day ? withDayOfMonth(todayStr, card.due_day) : null,
      next_statement_date: null,
      next_due_date: card.due_day ? withDayOfMonth(shiftMonths(todayStr, 1), card.due_day) : null,
      statement_balance: owed, amount_due: owed, cycle_spend: 0, unbilled_spend: 0,
      paid_since_statement: 0, settled: owed <= 0,
    };
  }

  const { statementDate, periodStart, dueDate } = statementDatesFor(card.statement_day, card.due_day, todayStr);
  const nextStatementDate = withDayOfMonth(shiftMonths(statementDate, 1), card.statement_day);
  const nextDueDate = withDayOfMonth(shiftMonths(dueDate, 1), card.due_day ?? card.statement_day);

  let paidSince = 0, spentSince = 0, cycleSpend = 0;
  for (const tx of txs) {
    const delta = cardDelta(tx, card.id);
    if (delta === 0) continue;
    const day = localDate(tx.occurred_at, tzOffsetMin);
    if (day > statementDate) {
      if (delta > 0) paidSince += delta; else spentSince += -delta;
    } else if (day >= periodStart && delta < 0) {
      cycleSpend += -delta;
    }
  }

  // Balance as of the moment the statement closed = today's balance with
  // everything that happened after it backed out. Payments made since then
  // knock down the statement first, and only what's left over counts against
  // post-statement spend (which isn't due until the next cycle anyway).
  const balanceAtStatement = currentBalance - (paidSince - spentSince);
  const statementBalance = Math.max(0, -balanceAtStatement);
  const amountDue = Math.max(0, statementBalance - paidSince);
  const leftoverPayment = Math.max(0, paidSince - statementBalance);
  const unbilled = Math.max(0, spentSince - leftoverPayment);

  return {
    ...base,
    period_start: periodStart, statement_date: statementDate, due_date: dueDate,
    next_statement_date: nextStatementDate, next_due_date: nextDueDate,
    statement_balance: round2(statementBalance), amount_due: round2(amountDue),
    cycle_spend: round2(cycleSpend), unbilled_spend: round2(unbilled),
    paid_since_statement: round2(paidSince), settled: amountDue <= 0,
  };
}

async function loadStatementCycles(user: AuthedUser, tzOffsetMin: number): Promise<StatementCycle[]> {
  const todayStr = localDate(new Date(), tzOffsetMin);
  const cards = await pg(`/accounts${qs({ user_id: `eq.${user.sub}`, type: "eq.credit", is_archived: "eq.false", select: "*", order: "sort_order.asc" })}`) as CreditAccountRow[];
  if (cards.length === 0) return [];

  // One transactions query for every card, from the oldest cycle start any
  // of them needs - per-card queries would be N round trips for no gain.
  const earliest = cards.reduce((min, c) => {
    if (!c.statement_day) return min;
    const { periodStart } = statementDatesFor(c.statement_day, c.due_day, todayStr);
    return periodStart < min ? periodStart : min;
  }, todayStr);

  const ids = cards.map((c) => c.id).join(",");
  const txs = await pg(
    `/transactions${qs({ user_id: `eq.${user.sub}`, select: "account_id,transfer_to_account_id,type,amount,occurred_at" })}` +
    `&or=(account_id.in.(${ids}),transfer_to_account_id.in.(${ids}))` +
    `&occurred_at=gte.${instantFromLocal(earliest, tzOffsetMin, "start")}`,
  ) as CardTxRow[];

  return cards.map((c) => summarizeCard(c, txs, tzOffsetMin, todayStr));
}

async function handleCreditCardStatements(req: Request, user: AuthedUser): Promise<Response> {
  const tz = tzOffsetOf(new URL(req.url).searchParams);
  return json({ data: await loadStatementCycles(user, tz) });
}

// Called once per session on app load (no cron on this box) - catches up
// any auto_post recurring rules whose next_run_date has arrived, and pays
// autopay-enabled credit card *statements* on their due date. Capped
// iteration per rule guards against a rule that's been inactive/unvisited
// for a very long time generating an unbounded backlog of transactions in
// one pass.
async function handleProcessDue(req: Request, user: AuthedUser): Promise<Response> {
  const tz = tzOffsetOf(new URL(req.url).searchParams);
  const today = localDate(new Date(), tz);
  const postedRecurring: unknown[] = [];

  const dueRules = await pg(`/recurring_rules${qs({ user_id: `eq.${user.sub}`, is_active: "eq.true", auto_post: "eq.true", next_run_date: `lte.${today}`, select: "*" })}`);
  for (const initial of (dueRules as RecurringRuleRow[])) {
    let current = initial;
    let iterations = 0;
    while (current.next_run_date <= today && iterations < 24) {
      const cycleDate = current.next_run_date;
      const tx = await postRecurringCycle(current, user, instantFromLocal(cycleDate, tz, "start"), cycleDate);
      postedRecurring.push(tx);

      const nextRunDate = advanceDate(cycleDate, current.frequency, current.interval_count);
      current = await pg(`/recurring_rules${qs({ id: `eq.${current.id}` })}`, {
        method: "PATCH", single: true,
        body: JSON.stringify({ next_run_date: nextRunDate, last_run_date: today, last_posted_period: cycleDate }),
      }) as RecurringRuleRow;
      iterations++;

      if (current.end_date && current.end_date < current.next_run_date) {
        await pg(`/recurring_rules${qs({ id: `eq.${current.id}` })}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
        break;
      }
    }
  }

  // Autopay settles the closed statement on its due date - not the full
  // outstanding balance, and not the moment the statement closes. Spend made
  // after the statement date stays on the card for the next cycle.
  const autopaySettled: unknown[] = [];
  const cards = await pg(`/accounts${qs({ user_id: `eq.${user.sub}`, type: "eq.credit", autopay_enabled: "eq.true", is_archived: "eq.false", select: "*" })}`) as CreditAccountRow[];
  const cycles = cards.length > 0 ? await loadStatementCycles(user, tz) : [];
  const cycleById = new Map(cycles.map((c) => [c.account_id, c]));

  for (const card of cards) {
    const cycle = cycleById.get(card.id);
    if (!card.autopay_account_id || !cycle) continue;
    if (cycle.amount_due <= 0) continue;
    if (!cycle.due_date || today < cycle.due_date) continue; // not due yet
    // Keyed by the statement it settles, so a cycle that closes in one month
    // and is due in the next isn't mistaken for one that's already paid.
    const settlementKey = cycle.statement_date ?? cycle.due_date;
    if (card.last_settled_statement === settlementKey) continue;

    const tx = await pg(`/transactions`, {
      method: "POST", single: true,
      body: JSON.stringify({
        user_id: user.sub, account_id: card.autopay_account_id, transfer_to_account_id: card.id,
        type: "transfer", amount: cycle.amount_due,
        description: `Autopay - ${card.name} statement${cycle.statement_date ? ` (${formatDayLabel(cycle.statement_date)})` : ""}`,
        occurred_at: new Date().toISOString(),
      }),
    });
    await applyBalanceEffect(tx as TxRow, 1);
    await pg(`/accounts${qs({ id: `eq.${card.id}` })}`, {
      method: "PATCH",
      body: JSON.stringify({ autopay_last_run: today, last_settled_statement: settlementKey }),
    });
    autopaySettled.push(tx);
  }

  return json({ posted_recurring: postedRecurring, autopay_settled: autopaySettled });
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

// --- Reports ---------------------------------------------------------------

// Spend with no category set still has to appear in the category chart -
// dropping it (as this used to) silently hid every uncategorised card swipe
// and every subscription posted without a category, so the pie chart added
// up to less than the "Expense" total sitting right above it.
const UNCATEGORIZED_KEY = "uncategorized";

function rangeToDates(range: string, startParam: string | null, endParam: string | null, tzOffsetMin: number): { start: string; end: string } {
  if (range === "custom" && startParam && endParam) return { start: startParam, end: endParam };

  const today = localDate(new Date(), tzOffsetMin);
  if (range === "day") return { start: today, end: today };
  if (range === "week") return { start: shiftDays(today, -6), end: today };
  if (range === "year") return { start: `${today.slice(0, 4)}-01-01`, end: today };
  return { start: withDayOfMonth(today, 1), end: today }; // month (default)
}

/** Every bucket in the range, zeros included, so a chart doesn't skip quiet days. */
function buildTrend(
  start: string, end: string, granularity: "day" | "month",
  totals: Record<string, { income: number; expense: number }>,
): Array<{ date: string; income: number; expense: number }> {
  const out: Array<{ date: string; income: number; expense: number }> = [];
  const last = granularity === "day" ? end : end.slice(0, 7);
  let cursor = granularity === "day" ? start : start.slice(0, 7);
  for (let i = 0; cursor <= last && i < 400; i++) {
    out.push({ date: cursor, income: 0, expense: 0, ...totals[cursor] });
    cursor = granularity === "day" ? shiftDays(cursor, 1) : shiftMonths(`${cursor}-01`, 1).slice(0, 7);
  }
  return out;
}

async function handleReportsSummary(req: Request, user: AuthedUser): Promise<Response> {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") || "month";
  const tz = tzOffsetOf(url.searchParams);
  const { start, end } = rangeToDates(range, url.searchParams.get("start"), url.searchParams.get("end"), tz);

  // Bounds are the user's local midnight-to-midnight converted to absolute
  // instants - comparing a timestamptz against a bare "YYYY-MM-DDT00:00:00"
  // resolved in the *container's* zone is what used to push early-morning
  // spend out of "today" (and out of the first day of the month).
  const transactions = await pg(
    `/transactions${qs({ user_id: `eq.${user.sub}`, select: "id,type,amount,category_id,occurred_at,is_group_expense,group_total_amount" })}` +
    `&and=(occurred_at.gte.${instantFromLocal(start, tz, "start")},occurred_at.lte.${instantFromLocal(end, tz, "end")})`,
  );

  const spanDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  const granularity: "day" | "month" = spanDays > 62 ? "month" : "day";

  let income = 0, expense = 0, groupExpenseTotal = 0;
  const byCategory: Record<string, number> = {};
  const byBucket: Record<string, { income: number; expense: number }> = {};

  for (const t of transactions as Array<{ type: string; amount: string; category_id: string | null; occurred_at: string; is_group_expense: boolean; group_total_amount: string | null }>) {
    const amt = Number(t.amount);
    const day = localDate(t.occurred_at, tz);
    const bucket = granularity === "day" ? day : day.slice(0, 7);
    byBucket[bucket] ??= { income: 0, expense: 0 };
    if (t.type === "income") { income += amt; byBucket[bucket].income += amt; }
    else if (t.type === "expense") {
      expense += amt; byBucket[bucket].expense += amt;
      const categoryKey = t.category_id ?? UNCATEGORIZED_KEY;
      byCategory[categoryKey] = (byCategory[categoryKey] || 0) + amt;
      if (t.is_group_expense && t.group_total_amount) groupExpenseTotal += Number(t.group_total_amount);
    }
  }

  const accounts = await pg(`/accounts${qs({ user_id: `eq.${user.sub}`, is_archived: "eq.false", select: "id,name,current_balance,type" })}`);
  const totalBalance = (accounts as Array<{ current_balance: string }>).reduce((sum, a) => sum + Number(a.current_balance), 0);

  const activeLoans = await pg(`/loans${qs({ user_id: `eq.${user.sub}`, status: "eq.active", select: "id,name,emi_amount" })}`);
  let loanOutstanding = 0;
  if (Array.isArray(activeLoans) && activeLoans.length > 0) {
    const pending = await pg(`/loan_payments${qs({ user_id: `eq.${user.sub}`, status: "neq.paid", select: "principal_component" })}`);
    loanOutstanding = (pending as Array<{ principal_component: string }>).reduce((sum, p) => sum + Number(p.principal_component), 0);
  }

  const budgets = await pg(`/budgets${qs({ user_id: `eq.${user.sub}`, is_active: "eq.true", select: "id,category_id,period,amount_limit" })}`);
  const budgetVsActual = (budgets as Array<{ id: string; category_id: string | null; period: string; amount_limit: string }>).map((b) => ({
    ...b,
    spent: b.category_id ? (byCategory[b.category_id] || 0) : expense,
  }));

  return json({
    range: { range, start, end, granularity },
    totals: { income, expense, net: income - expense, group_expense_total: groupExpenseTotal },
    by_category: byCategory,
    trend: buildTrend(start, end, granularity, byBucket),
    net_worth: totalBalance - loanOutstanding,
    total_balance: totalBalance,
    loan_outstanding: loanOutstanding,
    budgets: budgetVsActual,
  });
}

// --- Upload (receipts, writes directly to the shared public-cdn volume) ----

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function handleUpload(req: Request, user: AuthedUser): Promise<Response> {
  const fileName = req.headers.get("x-file-name");
  if (!fileName || !SAFE_FILENAME.test(fileName)) {
    return json({ error: "Missing or invalid x-file-name header" }, 400);
  }
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return json({ error: "Empty file body" }, 400);
  if (buffer.byteLength > MAX_FILE_BYTES) return json({ error: "File exceeds 10MB limit" }, 413);

  const safeName = `${user.sub}-${fileName}`;
  const targetDir = `/home/deno/public-cdn/images/moneyos`;
  await Deno.mkdir(targetDir, { recursive: true });
  await Deno.writeFile(`${targetDir}/${safeName}`, new Uint8Array(buffer));

  return json({ url: `https://mystorage.dileepadari.dev/images/moneyos/${safeName}` });
}

// --- Router ------------------------------------------------------------
// `path` is already stripped of the leading "/moneyos" by the caller.

export async function moneyosRouter(req: Request, path: string): Promise<Response> {
  try {
    if (req.method === "POST" && path === "/auth/signup") return await handleSignup(req);
    if (req.method === "POST" && path === "/auth/login") return await handleLogin(req);

    const user = await requireAuth(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    if (req.method === "GET" && path === "/auth/me") return await handleMe(req, user);
    if (req.method === "PATCH" && path === "/auth/me") return await handleUpdateMe(req, user);

    if (req.method === "POST" && path === "/data") return await handleData(req, user);

    if (req.method === "GET" && path === "/transactions") return await handleListTransactions(req, user);
    if (req.method === "POST" && path === "/transactions") return await handleCreateTransaction(req, user);
    const txMatch = path.match(/^\/transactions\/([^/]+)$/);
    if (req.method === "PATCH" && txMatch) return await handleUpdateTransaction(req, txMatch[1], user);
    if (req.method === "DELETE" && txMatch) return await handleDeleteTransaction(txMatch[1], user);

    if (req.method === "POST" && path === "/accounts/transfer") return await handleTransfer(req, user);

    if (req.method === "POST" && path === "/loans") return await handleCreateLoan(req, user);
    const loanMatch = path.match(/^\/loans\/([^/]+)$/);
    if (req.method === "PATCH" && loanMatch) return await handleUpdateLoan(req, loanMatch[1], user);
    const scheduleMatch = path.match(/^\/loans\/([^/]+)\/schedule$/);
    if (req.method === "GET" && scheduleMatch) return await handleLoanSchedule(scheduleMatch[1], user);
    const payMatch = path.match(/^\/loans\/([^/]+)\/payments\/([^/]+)\/pay$/);
    if (req.method === "POST" && payMatch) return await handlePayLoanInstallment(req, payMatch[1], payMatch[2], user);

    const recurringPostMatch = path.match(/^\/recurring_rules\/([^/]+)\/post$/);
    if (req.method === "POST" && recurringPostMatch) return await handlePostRecurringRule(req, recurringPostMatch[1], user);

    if (req.method === "GET" && path === "/credit-cards/statements") return await handleCreditCardStatements(req, user);

    if (req.method === "POST" && path === "/process-due") return await handleProcessDue(req, user);

    if (req.method === "GET" && path === "/reports/summary") return await handleReportsSummary(req, user);

    if (req.method === "POST" && path === "/upload") return await handleUpload(req, user);

    return json({ error: "Route or method not found" }, 404);
  } catch (err) {
    if (err instanceof PostgrestError) return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 500);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
}
