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
  return json({ data: updated });
}

async function handleDeleteTransaction(id: string, user: AuthedUser): Promise<Response> {
  const existingRows = await pg(`/transactions${qs({ id: `eq.${id}`, user_id: `eq.${user.sub}` })}`);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!existing) return json({ error: "Not found" }, 404);

  await applyBalanceEffect(existing as TxRow, -1);

  // Deleting a payment made *into* a credit card (autopay-generated or a
  // manual transfer) undoes that settlement - clear autopay_last_run so the
  // card is eligible to be flagged as due again instead of silently staying
  // "already settled this month" even though the balance now shows it owed.
  const txWithTransfer = existing as TxRow;
  if (txWithTransfer.type === "transfer" && txWithTransfer.transfer_to_account_id) {
    const targetRows = await pg(`/accounts${qs({ id: `eq.${txWithTransfer.transfer_to_account_id}`, type: "eq.credit", select: "id" })}`);
    if (Array.isArray(targetRows) && targetRows.length > 0) {
      await pg(`/accounts${qs({ id: `eq.${txWithTransfer.transfer_to_account_id}` })}`, { method: "PATCH", body: JSON.stringify({ autopay_last_run: null }) });
    }
  }

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
}

async function postRecurringCycle(rule: RecurringRuleRow, user: AuthedUser, occurredAt: string) {
  const tx = await pg(`/transactions`, {
    method: "POST", single: true,
    body: JSON.stringify({
      user_id: user.sub, account_id: rule.account_id, category_id: rule.category_id,
      payment_method_id: rule.payment_method_id, type: rule.type, amount: rule.amount,
      currency: rule.currency, description: rule.name, occurred_at: occurredAt,
      recurring_rule_id: rule.id,
    }),
  });
  await applyBalanceEffect(tx as TxRow, 1);
  return tx;
}

// Manual "mark this cycle paid" for a subscription/recurring expense that
// isn't flagged auto_post - posts one transaction for the *current* cycle
// (whatever next_run_date currently is, even if the user is doing this
// early or a bit late) and advances the schedule by one interval.
async function handlePostRecurringRule(ruleId: string, user: AuthedUser): Promise<Response> {
  const rows = await pg(`/recurring_rules${qs({ id: `eq.${ruleId}`, user_id: `eq.${user.sub}` })}`);
  const rule = Array.isArray(rows) ? (rows[0] as RecurringRuleRow) : null;
  if (!rule) return json({ error: "Not found" }, 404);

  const tx = await postRecurringCycle(rule, user, new Date().toISOString());
  const nextRunDate = advanceDate(rule.next_run_date, rule.frequency, rule.interval_count);
  const updatedRule = await pg(`/recurring_rules${qs({ id: `eq.${ruleId}` })}`, {
    method: "PATCH", single: true,
    body: JSON.stringify({ next_run_date: nextRunDate, last_run_date: new Date().toISOString().slice(0, 10) }),
  });

  return json({ data: updatedRule, transaction: tx });
}

interface CreditAccountRow {
  id: string; name: string; current_balance: string; autopay_account_id: string | null;
  billing_day: number | null; autopay_last_run: string | null;
}

// Called once per session on app load (no cron on this box) - catches up
// any auto_post recurring rules whose next_run_date has arrived, and
// settles autopay-enabled credit card balances once their billing_day has
// passed for the current month. Capped iteration per rule guards against a
// rule that's been inactive/unvisited for a very long time generating an
// unbounded backlog of transactions in one pass.
async function handleProcessDue(user: AuthedUser): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  const postedRecurring: unknown[] = [];

  const dueRules = await pg(`/recurring_rules${qs({ user_id: `eq.${user.sub}`, is_active: "eq.true", auto_post: "eq.true", next_run_date: `lte.${today}`, select: "*" })}`);
  for (const initial of (dueRules as RecurringRuleRow[])) {
    let current = initial;
    let iterations = 0;
    while (current.next_run_date <= today && iterations < 24) {
      const tx = await postRecurringCycle(current, user, `${current.next_run_date}T00:00:00.000Z`);
      postedRecurring.push(tx);

      const nextRunDate = advanceDate(current.next_run_date, current.frequency, current.interval_count);
      current = await pg(`/recurring_rules${qs({ id: `eq.${current.id}` })}`, {
        method: "PATCH", single: true,
        body: JSON.stringify({ next_run_date: nextRunDate, last_run_date: today }),
      }) as RecurringRuleRow;
      iterations++;

      if (current.end_date && current.end_date < current.next_run_date) {
        await pg(`/recurring_rules${qs({ id: `eq.${current.id}` })}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
        break;
      }
    }
  }

  const autopaySettled: unknown[] = [];
  const dayOfMonth = new Date().getDate();
  const creditAccounts = await pg(`/accounts${qs({ user_id: `eq.${user.sub}`, type: "eq.credit", autopay_enabled: "eq.true", is_archived: "eq.false", select: "*" })}`);
  for (const card of (creditAccounts as CreditAccountRow[])) {
    if (!card.autopay_account_id || !card.billing_day) continue;
    const owed = -Number(card.current_balance);
    if (owed <= 0) continue; // nothing owed, or card is in credit
    if (dayOfMonth < card.billing_day) continue; // not due yet this cycle
    if (card.autopay_last_run && card.autopay_last_run.slice(0, 7) === today.slice(0, 7)) continue; // already settled this month

    const tx = await pg(`/transactions`, {
      method: "POST", single: true,
      body: JSON.stringify({
        user_id: user.sub, account_id: card.autopay_account_id, transfer_to_account_id: card.id,
        type: "transfer", amount: owed, description: `Autopay - ${card.name} bill`, occurred_at: new Date().toISOString(),
      }),
    });
    await applyBalanceEffect(tx as TxRow, 1);
    await pg(`/accounts${qs({ id: `eq.${card.id}` })}`, { method: "PATCH", body: JSON.stringify({ autopay_last_run: today }) });
    autopaySettled.push(tx);
  }

  return json({ posted_recurring: postedRecurring, autopay_settled: autopaySettled });
}

// --- Reports ---------------------------------------------------------------

function rangeToDates(range: string, startParam: string | null, endParam: string | null): { start: string; end: string } {
  const now = new Date();
  if (range === "custom" && startParam && endParam) return { start: startParam, end: endParam };

  const end = new Date(now);
  const start = new Date(now);
  if (range === "day") { /* start == end == today */ }
  else if (range === "week") start.setDate(start.getDate() - 6);
  else if (range === "year") { start.setMonth(0, 1); }
  else { start.setDate(1); } // month (default)

  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function handleReportsSummary(req: Request, user: AuthedUser): Promise<Response> {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") || "month";
  const { start, end } = rangeToDates(range, url.searchParams.get("start"), url.searchParams.get("end"));

  const transactions = await pg(
    `/transactions${qs({ user_id: `eq.${user.sub}`, select: "id,type,amount,category_id,occurred_at,is_group_expense,group_total_amount" })}&and=(occurred_at.gte.${start}T00:00:00,occurred_at.lte.${end}T23:59:59)`,
  );

  let income = 0, expense = 0, groupExpenseTotal = 0;
  const byCategory: Record<string, number> = {};
  const byDay: Record<string, { income: number; expense: number }> = {};

  for (const t of transactions as Array<{ type: string; amount: string; category_id: string | null; occurred_at: string; is_group_expense: boolean; group_total_amount: string | null }>) {
    const amt = Number(t.amount);
    const day = t.occurred_at.slice(0, 10);
    byDay[day] ??= { income: 0, expense: 0 };
    if (t.type === "income") { income += amt; byDay[day].income += amt; }
    else if (t.type === "expense") {
      expense += amt; byDay[day].expense += amt;
      if (t.category_id) byCategory[t.category_id] = (byCategory[t.category_id] || 0) + amt;
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
    range: { range, start, end },
    totals: { income, expense, net: income - expense, group_expense_total: groupExpenseTotal },
    by_category: byCategory,
    trend: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
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
    if (req.method === "POST" && recurringPostMatch) return await handlePostRecurringRule(recurringPostMatch[1], user);

    if (req.method === "POST" && path === "/process-due") return await handleProcessDue(user);

    if (req.method === "GET" && path === "/reports/summary") return await handleReportsSummary(req, user);

    if (req.method === "POST" && path === "/upload") return await handleUpload(req, user);

    return json({ error: "Route or method not found" }, 404);
  } catch (err) {
    if (err instanceof PostgrestError) return json({ error: err.message }, err.status >= 400 && err.status < 600 ? err.status : 500);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
}
