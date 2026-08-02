# MoneyOS

A personal finance manager: track every expense and income, budget by category, save toward goals, pay off EMIs, and split group expenses - all in one place, with your account balances actually updating as you spend.

> Looking for architecture, data model, and setup details? See **[DEVDOC.md](./DEVDOC.md)**.

## Features

### Dashboard
- Live total balance, this month's income/spend, net worth (balances minus outstanding loans)
- Spending trend chart, upcoming EMI/bill dues, recent transactions
- A reminders bell (top of the nav) surfaces anything due - or an unresolved credit card autopay - within 2 days

### Accounts
- Multiple wallets (cash, bank, savings, card, credit, UPI) with running balances, full edit, and archive
- Transfers between accounts
- Every transaction automatically adjusts the right account's balance
- **Credit cards**: set a credit limit, a statement (billing) day, and a payment due day; card spending shows as "owed" against the limit instead of a plain balance
- **Real statement cycles**: everything spent between one statement day and the next is that cycle's bill, due on the due day. Anything swiped after the statement day is shown separately as unbilled and rolls into next month's bill instead of being demanded early. Autopay pays the statement amount on its due date - if it's not resolved, the reminders bell flags it 2 days out

### Transactions
- Expense / income / transfer, with category, payment method, date **and time**, tags, notes, and a receipt photo
- Payment method covers cash and every common UPI app - Google Pay, PhonePe, Paytm, CRED, FamPay, Amazon Pay, BHIM, WhatsApp Pay - plus cards, net banking, and bank transfer
- **Group expenses**: log what it was for, how many people split it, and your share - only your share is subtracted from your balance; the total and headcount are kept for reporting
- Filters by date range, account, category, type, and free-text search

### Budgets
- Per-category or overall spending limits (weekly/monthly/yearly) with live progress and overspend warnings, full edit and delete

### Goals
- Savings targets with a target date, progress bar, and a suggested monthly contribution to hit it on time; edit the name/target/date any time, or delete

### EMIs & Loans
- Add a loan and get the full amortization schedule generated instantly (reducing-balance method)
- Built-in EMI calculator (principal/rate/tenure → suggested monthly payment)
- Mark installments paid one at a time - each posts a linked transaction and decrements the right account; the loan auto-closes once every installment is paid
- Got the amount, rate, tenure, or start date wrong? Edit the loan and every *unpaid* installment recalculates - anything already paid is left exactly as it was. Delete a loan entirely if you added it by mistake

### Subscriptions & recurring expenses
- Track subscriptions and repeating expenses (rent, etc.) with full edit/delete
- Turn on autopay to have a cycle post itself as a transaction and debit the account automatically when due - no manual step
- Every row says which cycle it's due for ("Due for Aug 2026") and which one it was last paid for, so a "Mark paid" that already registered is obvious
- Without autopay, "Mark paid" posts the transaction for the current cycle and schedules the next one - clicking it twice can't post two months, the second click is rejected

### Reports
- Day / week / month / year views: income vs. expense trend, spend-by-category donut, category breakdown, budget-vs-actual
- Every expense counts, including card spend and subscription-posted rent; anything without a category is shown as its own "Uncategorized" slice rather than dropped, so the donut always adds up to the expense total
- Day buckets follow your own timezone, so a late-night expense stays on the day you made it

### Bill reminders
- Standalone due-date reminders separate from EMIs, with edit, delete, and a one-tap "mark paid"

### Categories & payment methods
- Rename or delete any category or payment method you've added; built-in defaults (Food, Google Pay, etc.) stay fixed so reporting never breaks under you

### Customization
- Light/dark mode plus 6 accent palettes (Emerald, Ocean, Sunset, Violet, Rose, Slate) or a custom brand color

### Data ownership
- Full transaction export as JSON, any time, from Settings

## Tech stack

React 19 + TypeScript + Vite, Tailwind CSS v4 + shadcn/ui, TanStack Query, `recharts`. Backend is a self-hosted Postgres reached through a single custom edge function - see [DEVDOC.md](./DEVDOC.md) for why there's no Supabase Auth or client SDK involved.

## Getting started

```sh
npm install
npm run dev
```

Requires a `.env` with `VITE_SUPABASE_URL` pointed at the backend. See [DEVDOC.md](./DEVDOC.md) for the full environment variable list and deployment notes.
