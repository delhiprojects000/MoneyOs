# MoneyOS

A personal finance manager: track every expense and income, budget by category, save toward goals, pay off EMIs, and split group expenses — all in one place, with your account balances actually updating as you spend.

> Looking for architecture, data model, and setup details? See **[DEVDOC.md](./DEVDOC.md)**.

## Features

### Dashboard
- Live total balance, this month's income/spend, net worth (balances minus outstanding loans)
- Spending trend chart, upcoming EMI/bill dues, recent transactions

### Accounts
- Multiple wallets (cash, bank, savings, card, credit, UPI) with running balances
- Transfers between accounts
- Every transaction automatically adjusts the right account's balance

### Transactions
- Expense / income / transfer, with category, payment method, date **and time**, tags, notes, and a receipt photo
- Payment method covers cash and every common UPI app — Google Pay, PhonePe, Paytm, CRED, FamPay, Amazon Pay, BHIM, WhatsApp Pay — plus cards, net banking, and bank transfer
- **Group expenses**: log what it was for, how many people split it, and your share — only your share is subtracted from your balance; the total and headcount are kept for reporting
- Filters by date range, account, category, type, and free-text search

### Budgets
- Per-category or overall spending limits (weekly/monthly/yearly) with live progress and overspend warnings

### Goals
- Savings targets with a target date, progress bar, and a suggested monthly contribution to hit it on time

### EMIs & Loans
- Add a loan and get the full amortization schedule generated instantly (reducing-balance method)
- Built-in EMI calculator (principal/rate/tenure → suggested monthly payment)
- Mark installments paid one at a time — each posts a linked transaction and decrements the right account; the loan auto-closes once every installment is paid

### Reports
- Day / week / month / year views: income vs. expense trend, spend-by-category donut, category breakdown, budget-vs-actual

### Bill reminders
- Standalone due-date reminders separate from EMIs, with a one-tap "mark paid"

### Customization
- Light/dark mode plus 6 accent palettes (Emerald, Ocean, Sunset, Violet, Rose, Slate) or a custom brand color

### Data ownership
- Full transaction export as JSON, any time, from Settings

## Tech stack

React 19 + TypeScript + Vite, Tailwind CSS v4 + shadcn/ui, TanStack Query, `recharts`. Backend is a self-hosted Postgres reached through a single custom edge function — see [DEVDOC.md](./DEVDOC.md) for why there's no Supabase Auth or client SDK involved.

## Getting started

```sh
npm install
npm run dev
```

Requires a `.env` with `VITE_SUPABASE_URL` pointed at the backend. See [DEVDOC.md](./DEVDOC.md) for the full environment variable list and deployment notes.
