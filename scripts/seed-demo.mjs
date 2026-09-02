#!/usr/bin/env node
// Seeds the demo account with a realistic, fully populated MoneyOS.
//
// Idempotent: every entity is looked up by name before it is created, so
// running this twice leaves the same data rather than doubling it.
//
// Guard: it refuses to run against any account whose username is not in
// DEMO_USERNAMES. This script writes real rows through the real API, so it
// must never be pointed at a personal account.
//
// Usage:
//   VITE_SUPABASE_URL=https://... node scripts/seed-demo.mjs
//   node scripts/seed-demo.mjs --username demo --password 'DemoPass123!'

const DEMO_USERNAMES = new Set(['demo', 'demo2', 'admin']);

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);

const BASE = (args.url || process.env.VITE_SUPABASE_URL || 'https://supabase.dileepadari.dev').replace(/\/$/, '');
const API = `${BASE}/functions/v1/moneyos`;
const USERNAME = args.username || 'demo';
const PASSWORD = args.password || 'DemoPass123!';

if (!DEMO_USERNAMES.has(USERNAME)) {
  console.error(`Refusing to seed "${USERNAME}" - only ${[...DEMO_USERNAMES].join(', ')} are seedable.`);
  process.exit(1);
}

let token = '';

async function call(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error ?? text}`);
  return json;
}

const data = (table, operation, extra = {}) => call('/data', 'POST', { table, operation, ...extra });
const select = (table, extra = {}) => data(table, 'select', extra).then((r) => r.data ?? []);
const insert = (table, payload) => data(table, 'insert', { payload }).then((r) => r.data);

/** Days before today, as an ISO instant at a plausible time of day. */
function daysAgo(n, hour = 13, minute = 20) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Calendar date (YYYY-MM-DD) n days from today, negative for the past. */
function dateIn(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Seeding ${USERNAME} at ${BASE}`);
  ({ token } = await call('/auth/login', 'POST', { username: USERNAME, password: PASSWORD }));

  const categories = await select('categories', { order: 'sort_order.asc' });
  const methods = await select('payment_methods', { order: 'sort_order.asc' });
  const cat = (name) => categories.find((c) => c.name === name)?.id ?? null;
  const pm = (name) => methods.find((m) => m.name === name)?.id ?? null;

  // --- Accounts -----------------------------------------------------------
  const existingAccounts = await select('accounts');
  const byName = new Map(existingAccounts.map((a) => [a.name, a]));

  async function account(spec) {
    const found = byName.get(spec.name);
    // Signup auto-creates a zero-balance "Cash" wallet. Give it the demo
    // opening balance the first time through, otherwise cash spending drives
    // it negative and the accounts page shows a wallet that owes money.
    if (found && found.opening_balance === 0 && spec.opening_balance > 0) {
      await data('accounts', 'update', { id: found.id, payload: { opening_balance: spec.opening_balance, current_balance: spec.current_balance, icon: spec.icon, color: spec.color, sort_order: spec.sort_order } });
      return { ...found, ...spec };
    }
    if (found) return found;
    const created = await insert('accounts', spec);
    byName.set(spec.name, created);
    console.log(`  account: ${spec.name}`);
    return created;
  }

  const cash = await account({ name: 'Cash', type: 'cash', opening_balance: 4200, current_balance: 4200, icon: 'banknote', color: '#16a34a', sort_order: 10 });
  const hdfc = await account({ name: 'HDFC Savings', type: 'savings', opening_balance: 186500, current_balance: 186500, icon: 'landmark', color: '#0284c7', sort_order: 20 });
  const sbi = await account({ name: 'SBI Salary', type: 'bank', opening_balance: 62400, current_balance: 62400, icon: 'landmark', color: '#7c3aed', sort_order: 30 });
  const gpay = await account({ name: 'GPay Wallet', type: 'upi', opening_balance: 9500, current_balance: 9500, icon: 'smartphone', color: '#ea580c', sort_order: 40 });
  const card = await account({
    name: 'HDFC Millennia', type: 'credit', opening_balance: 0, current_balance: 0,
    icon: 'credit-card', color: '#e11d48', sort_order: 50,
    credit_limit: 150000, statement_day: 18, due_day: 5,
    autopay_enabled: true, autopay_account_id: hdfc.id,
  });

  // --- Transactions -------------------------------------------------------
  // Spread across four months so the trend chart and the month/year report
  // ranges all have shape, and every account and status is represented.
  const existingTx = await select('transactions', { limit: 500 });
  const seenDescriptions = new Set(existingTx.map((t) => t.description));

  const TX = [
    // Income
    { d: 92, acc: sbi, type: 'income', amount: 78000, category: 'Salary', desc: 'Monthly salary - June', method: 'Bank transfer' },
    { d: 61, acc: sbi, type: 'income', amount: 78000, category: 'Salary', desc: 'Monthly salary - July', method: 'Bank transfer' },
    { d: 31, acc: sbi, type: 'income', amount: 82500, category: 'Salary', desc: 'Monthly salary - August', method: 'Bank transfer' },
    { d: 1, acc: sbi, type: 'income', amount: 82500, category: 'Salary', desc: 'Monthly salary - September', method: 'Bank transfer' },
    { d: 44, acc: hdfc, type: 'income', amount: 15000, category: 'Freelance', desc: 'Landing page build for Nayara Textiles' },
    { d: 20, acc: hdfc, type: 'income', amount: 2480, category: 'Investment Income', desc: 'Mutual fund dividend' },
    { d: 12, acc: gpay, type: 'income', amount: 640, category: 'Refunds', desc: 'Refund - cancelled Rapido ride' },

    // Rent and utilities
    { d: 88, acc: hdfc, type: 'expense', amount: 18500, category: 'Rent', desc: 'Flat rent - June', method: 'Bank transfer' },
    { d: 58, acc: hdfc, type: 'expense', amount: 18500, category: 'Rent', desc: 'Flat rent - July', method: 'Bank transfer' },
    { d: 27, acc: hdfc, type: 'expense', amount: 18500, category: 'Rent', desc: 'Flat rent - August', method: 'Bank transfer' },
    { d: 25, acc: gpay, type: 'expense', amount: 1340, category: 'Utilities', desc: 'TSSPDCL electricity bill', method: 'Google Pay' },
    { d: 24, acc: gpay, type: 'expense', amount: 799, category: 'Utilities', desc: 'ACT Fibernet broadband', method: 'Google Pay' },

    // Food, groceries, transport - the everyday noise that makes it look used
    { d: 21, acc: card, type: 'expense', amount: 1280, category: 'Food & Dining', desc: 'Dinner at Ohri’s Banjara', method: 'Credit card', tags: ['eating-out'] },
    { d: 19, acc: gpay, type: 'expense', amount: 340, category: 'Food & Dining', desc: 'Chai and samosa run', method: 'Google Pay' },
    { d: 17, acc: card, type: 'expense', amount: 3860, category: 'Groceries', desc: 'BigBasket monthly stock-up', method: 'Credit card' },
    { d: 15, acc: gpay, type: 'expense', amount: 210, category: 'Transport', desc: 'Metro recharge', method: 'Google Pay' },
    { d: 14, acc: gpay, type: 'expense', amount: 189, category: 'Transport', desc: 'Uber to Gachibowli', method: 'Google Pay' },
    { d: 11, acc: card, type: 'expense', amount: 2450, category: 'Shopping', desc: 'Running shoes', method: 'Credit card', tags: ['fitness'] },
    { d: 9, acc: cash, type: 'expense', amount: 120, category: 'Food & Dining', desc: 'Filter coffee', method: 'Cash' },
    { d: 8, acc: card, type: 'expense', amount: 649, category: 'Entertainment', desc: 'PVR - Dune Part Three', method: 'Credit card' },
    { d: 6, acc: gpay, type: 'expense', amount: 1120, category: 'Groceries', desc: 'Zepto - weekly top-up', method: 'Google Pay' },
    { d: 5, acc: card, type: 'expense', amount: 899, category: 'Health & Medical', desc: 'Apollo pharmacy - vitamins', method: 'Credit card' },
    { d: 4, acc: gpay, type: 'expense', amount: 260, category: 'Food & Dining', desc: 'Swiggy - late night biryani', method: 'Google Pay' },
    { d: 3, acc: card, type: 'expense', amount: 5400, category: 'Travel', desc: 'Flight to Bengaluru - IndiGo 6E-2134', method: 'Credit card', tags: ['work-trip'] },
    { d: 2, acc: cash, type: 'expense', amount: 80, category: 'Transport', desc: 'Auto to station', method: 'Cash' },
    { d: 1, acc: gpay, type: 'expense', amount: 430, category: 'Food & Dining', desc: 'Breakfast at Chutneys', method: 'Google Pay' },

    // Current-month spend. Budgets and the dashboard's "this month" tiles are
    // calendar-month scoped, so without these every budget reads zero for the
    // first days of a month.
    { d: 1, acc: card, type: 'expense', amount: 2340, category: 'Groceries', desc: 'DMart monthly run', method: 'Credit card' },
    { d: 1, acc: gpay, type: 'expense', amount: 620, category: 'Transport', desc: 'Ola to airport', method: 'Google Pay' },
    { d: 1, acc: card, type: 'expense', amount: 1450, category: 'Entertainment', desc: 'Concert tickets - Hyderabad', method: 'Credit card' },
    { d: 0, acc: card, type: 'expense', amount: 2650, category: 'Shopping', desc: 'Winter jacket', method: 'Credit card' },
    { d: 0, acc: gpay, type: 'expense', amount: 385, category: 'Food & Dining', desc: 'Lunch at Rayalaseema Ruchulu', method: 'Google Pay' },
    { d: 0, acc: cash, type: 'expense', amount: 150, category: 'Transport', desc: 'Bus fare', method: 'Cash' },
    { d: 0, acc: gpay, type: 'expense', amount: 940, category: 'Groceries', desc: 'Blinkit - fruit and milk', method: 'Google Pay' },

    // Uncategorised spend, so the report's "Uncategorised" bucket is real
    { d: 13, acc: card, type: 'expense', amount: 1599, category: null, desc: 'Amazon order - unlabelled', method: 'Credit card' },
    { d: 7, acc: gpay, type: 'expense', amount: 275, category: null, desc: 'Vending machine top-up', method: 'Google Pay' },

    // A deliberately long description, to prove truncation behaves
    { d: 10, acc: hdfc, type: 'expense', amount: 12600, category: 'Education', desc: 'Advanced Distributed Systems certification course, second instalment including proctored exam fee', method: 'Bank transfer' },

    // Group expenses - the split-with-friends feature
    { d: 23, acc: card, type: 'expense', amount: 1450, category: 'Group Expenses', desc: 'Birthday dinner - my share', method: 'Credit card', group: { reason: "Aarav's birthday dinner", total: 5800, people: 4 } },
    { d: 16, acc: gpay, type: 'expense', amount: 620, category: 'Group Expenses', desc: 'Weekend trip fuel - my share', method: 'Google Pay', group: { reason: 'Vikarabad road trip fuel', total: 3100, people: 5 } },
    { d: 30, acc: card, type: 'expense', amount: 890, category: 'Group Expenses', desc: 'Team lunch - my share', method: 'Credit card', group: { reason: 'Sprint retro team lunch', total: 5340, people: 6 } },
  ];

  let txCount = 0;
  for (const t of TX) {
    if (seenDescriptions.has(t.desc)) continue;
    await call('/transactions', 'POST', {
      account_id: t.acc.id,
      type: t.type,
      amount: t.amount,
      category_id: t.category ? cat(t.category) : null,
      payment_method_id: t.method ? pm(t.method) : null,
      description: t.desc,
      occurred_at: daysAgo(t.d),
      tags: t.tags ?? [],
      ...(t.group
        ? { is_group_expense: true, group_reason: t.group.reason, group_total_amount: t.group.total, group_participant_count: t.group.people }
        : {}),
    });
    txCount++;
  }
  console.log(`  transactions: ${txCount} created`);

  // Transfers, including one card payment so the statement shows a part-payment
  if (!seenDescriptions.has('Top-up GPay wallet')) {
    await call('/accounts/transfer', 'POST', { from_account_id: hdfc.id, to_account_id: gpay.id, amount: 5000, description: 'Top-up GPay wallet', occurred_at: daysAgo(18) });
    await call('/accounts/transfer', 'POST', { from_account_id: sbi.id, to_account_id: hdfc.id, amount: 40000, description: 'Move salary to savings', occurred_at: daysAgo(26) });
    await call('/accounts/transfer', 'POST', { from_account_id: hdfc.id, to_account_id: card.id, amount: 4000, description: 'Part payment - HDFC Millennia', occurred_at: daysAgo(12) });
    console.log('  transfers: 3 created');
  }

  // --- Loans --------------------------------------------------------------
  const existingLoans = await select('loans');
  if (!existingLoans.some((l) => l.name === 'iPhone 16 Pro EMI')) {
    const { data: loan, schedule } = await call('/loans', 'POST', {
      name: 'iPhone 16 Pro EMI', lender_name: 'Bajaj Finserv',
      principal_amount: 119900, interest_rate: 13.5, tenure_months: 12,
      emi_amount: 10730, start_date: dateIn(-150), account_id: hdfc.id,
    });
    // Pay the instalments that are already in the past, so the loan shows
    // real progress and the next due date is genuinely the next one.
    let paid = 0;
    for (const p of schedule) {
      if (p.due_date >= dateIn(0) || paid >= 4) break;
      const row = (await call(`/loans/${loan.id}/schedule`)).data.find((x) => x.installment_number === p.installment_number);
      if (row && row.status !== 'paid') {
        const { transaction } = await call(`/loans/${loan.id}/payments/${row.id}/pay`, 'POST');
        // The pay route stamps the transaction with "now", which is correct
        // for a real payment but bunches every back-dated demo instalment
        // onto today. Move each one to the instalment's own due date.
        await call(`/transactions/${transaction.id}`, 'PATCH', { occurred_at: `${row.due_date}T10:15:00.000Z` });
        paid++;
      }
    }
    console.log(`  loan: iPhone 16 Pro EMI (${paid} instalments paid)`);
  }
  if (!existingLoans.some((l) => l.name === 'Laptop EMI')) {
    await call('/loans', 'POST', {
      name: 'Laptop EMI', lender_name: 'HDFC Bank',
      principal_amount: 84000, interest_rate: 0, tenure_months: 9,
      emi_amount: 9334, start_date: dateIn(-40), account_id: sbi.id,
    });
    console.log('  loan: Laptop EMI (0% no-cost EMI)');
  }

  // --- Subscriptions ------------------------------------------------------
  const existingRules = await select('recurring_rules');
  const ruleNames = new Set(existingRules.map((r) => r.name));
  const RULES = [
    { name: 'Netflix', amount: 649, frequency: 'monthly', next: 4, category: 'Subscriptions', acc: card, auto_post: true, method: 'Credit card' },
    { name: 'Spotify Duo', amount: 149, frequency: 'monthly', next: 9, category: 'Subscriptions', acc: card, auto_post: true, method: 'Credit card' },
    { name: 'Gym membership', amount: 1800, frequency: 'monthly', next: 2, category: 'Health & Medical', acc: gpay, auto_post: false, method: 'Google Pay' },
    { name: 'iCloud 2TB', amount: 749, frequency: 'monthly', next: 13, category: 'Subscriptions', acc: card, auto_post: true, method: 'Credit card' },
    { name: 'Domain renewal', amount: 1180, frequency: 'yearly', next: 46, category: 'Subscriptions', acc: card, auto_post: false, method: 'Credit card' },
    { name: 'Weekly house help', amount: 500, frequency: 'weekly', next: 1, category: 'Other Expense', acc: cash, auto_post: false, method: 'Cash' },
    // Paused, so the list shows an inactive row too
    { name: 'Audible', amount: 199, frequency: 'monthly', next: 20, category: 'Subscriptions', acc: card, auto_post: false, method: 'Credit card', is_active: false },
  ];
  let ruleCount = 0;
  for (const r of RULES) {
    if (ruleNames.has(r.name)) continue;
    await insert('recurring_rules', {
      name: r.name, type: 'expense', amount: r.amount, frequency: r.frequency, interval_count: 1,
      category_id: cat(r.category), account_id: r.acc.id, payment_method_id: pm(r.method),
      start_date: dateIn(-90), next_run_date: dateIn(r.next),
      auto_post: r.auto_post, is_active: r.is_active !== false,
    });
    ruleCount++;
  }
  console.log(`  subscriptions: ${ruleCount} created`);

  // --- Bill reminders -----------------------------------------------------
  const existingBills = await select('bills');
  const billNames = new Set(existingBills.map((b) => b.name));
  const BILLS = [
    { name: 'Car insurance renewal', amount: 14200, due: 11, category: 'Other Expense' },
    { name: 'Property tax', amount: 6800, due: -3, category: 'Other Expense' },        // overdue on purpose
    { name: 'Health insurance premium', amount: 22400, due: 26, category: 'Health & Medical' },
    { name: 'Phone bill', amount: 799, due: 6, category: 'Utilities' },
    { name: 'Water bill', amount: 410, due: -1, category: 'Utilities', is_paid: true }, // already settled
  ];
  let billCount = 0;
  for (const b of BILLS) {
    if (billNames.has(b.name)) continue;
    await insert('bills', { name: b.name, amount: b.amount, due_date: dateIn(b.due), category_id: cat(b.category), is_paid: !!b.is_paid, reminder_days_before: 3 });
    billCount++;
  }
  console.log(`  bills: ${billCount} created`);

  // --- Budgets ------------------------------------------------------------
  const existingBudgets = await select('budgets');
  const budgetCats = new Set(existingBudgets.map((b) => b.category_id));
  const BUDGETS = [
    { category: 'Food & Dining', limit: 8000 },
    { category: 'Groceries', limit: 6000 },
    { category: 'Transport', limit: 2500 },
    { category: 'Entertainment', limit: 2000 },   // deliberately close to its limit
    { category: 'Shopping', limit: 2000 },        // deliberately over its limit
  ];
  let budgetCount = 0;
  for (const b of BUDGETS) {
    const id = cat(b.category);
    if (!id || budgetCats.has(id)) continue;
    await insert('budgets', { category_id: id, period: 'monthly', amount_limit: b.limit, start_date: dateIn(-new Date().getDate() + 1), is_active: true });
    budgetCount++;
  }
  console.log(`  budgets: ${budgetCount} created`);

  // --- Goals --------------------------------------------------------------
  const existingGoals = await select('goals');
  const goalNames = new Set(existingGoals.map((g) => g.name));
  const GOALS = [
    { name: 'Emergency fund', target: 300000, current: 186000, date: 180, icon: 'shield', color: '#0284c7' },
    { name: 'Japan trip', target: 220000, current: 47500, date: 300, icon: 'plane', color: '#e11d48' },
    { name: 'New laptop', target: 165000, current: 165000, date: -10, icon: 'laptop', color: '#16a34a', status: 'completed' },
    { name: 'Camera lens', target: 68000, current: 12000, date: 240, icon: 'camera', color: '#7c3aed' },
  ];
  let goalCount = 0;
  for (const g of GOALS) {
    if (goalNames.has(g.name)) continue;
    await insert('goals', {
      name: g.name, target_amount: g.target, current_amount: g.current,
      target_date: dateIn(g.date), icon: g.icon, color: g.color, status: g.status ?? 'active',
    });
    goalCount++;
  }
  console.log(`  goals: ${goalCount} created`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
