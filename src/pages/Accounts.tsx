import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts, useCreateAccount, useUpdateAccount, useTransferFunds, useCreditCardStatements } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDayMonth, formatRelativeDay } from '@/lib/format';
import { Plus, Wallet, Landmark, CreditCard, Smartphone, PiggyBank, ArrowLeftRight, Archive, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { daysUntil } from '@/lib/upcoming';
import { CardGridSkeleton } from '@/components/skeletons/primitives';
import type { Account, AccountType, CreditCardStatement } from '@/lib/api';

const TYPE_ICONS: Record<AccountType, typeof Wallet> = {
  cash: Wallet, bank: Landmark, card: CreditCard, upi: Smartphone, wallet: Wallet, savings: PiggyBank, credit: CreditCard,
};

const TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank account' },
  { value: 'savings', label: 'Savings account' },
  { value: 'card', label: 'Card' },
  { value: 'credit', label: 'Credit card' },
  { value: 'upi', label: 'UPI wallet' },
  { value: 'wallet', label: 'Other wallet' },
];

export default function Accounts() {
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: statements = [] } = useCreditCardStatements();
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | undefined>(undefined);
  const [transferOpen, setTransferOpen] = useState(false);

  const active = accounts.filter((a) => !a.is_archived);
  const total = active.reduce((s, a) => s + a.current_balance, 0);
  const statementByCard = Object.fromEntries(statements.map((s) => [s.account_id, s]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-muted-foreground">Total across all wallets: <span className="font-medium text-foreground">{formatMoney(total, currency)}</span></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="mr-2 h-4 w-4" />Transfer</Button>
          <Button onClick={() => { setEditing(undefined); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add account</Button>
        </div>
      </div>

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((a) => {
            const Icon = TYPE_ICONS[a.type];
            const isCredit = a.type === 'credit';
            const owed = isCredit ? Math.max(0, -a.current_balance) : 0;
            const utilizationPct = isCredit && a.credit_limit ? Math.min(100, Math.round((owed / a.credit_limit) * 100)) : 0;
            return (
              <Card key={a.id} className="hover-lift cursor-pointer" onClick={() => { setEditing(a); setDialogOpen(true); }}>
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${a.color || '#16a34a'}20`, color: a.color || '#16a34a' }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isCredit && a.autopay_enabled && <Zap className="h-3.5 w-3.5 text-warning" />}
                      <span className="text-xs uppercase text-muted-foreground">{a.type}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.name}</p>
                  {isCredit ? (
                    <>
                      <p className={`mt-1 text-xl font-semibold tabular-nums ${owed > 0 ? 'text-destructive' : ''}`}>{formatMoney(owed, a.currency)} owed</p>
                      {a.credit_limit ? (
                        <>
                          <Progress value={utilizationPct} className="mt-2 h-1.5" />
                          <p className="mt-1 text-xs text-muted-foreground">{formatMoney(a.credit_limit - owed, a.currency)} available of {formatMoney(a.credit_limit, a.currency)}</p>
                        </>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">No credit limit set</p>
                      )}
                      <StatementSummary statement={statementByCard[a.id]} />
                    </>
                  ) : (
                    <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(a.current_balance, a.currency)}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {active.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground">No accounts yet. Add your first wallet to start tracking.</p>
          )}
        </div>
      )}

      <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} account={editing} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={active} currency={currency} />
    </div>
  );
}

// The two numbers that matter on a card are not the same thing: what the
// closed statement demands by its due date, and what's been swiped since that
// statement closed (which isn't owed until the *next* due date, however large
// it already is).
function StatementSummary({ statement }: { statement?: CreditCardStatement }) {
  if (!statement) return null;

  if (!statement.statement_day) {
    return (
      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
        Set a statement day to split this into "billed" and "not yet billed".
      </p>
    );
  }

  const overdue = statement.amount_due > 0 && statement.due_date != null && daysUntil(statement.due_date) < 0;

  return (
    <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
      {statement.amount_due > 0 ? (
        <p className={overdue ? 'text-destructive' : ''}>
          <span className="font-medium tabular-nums">{formatMoney(statement.amount_due, statement.currency)}</span>
          {' '}due {statement.due_date ? formatRelativeDay(statement.due_date).toLowerCase() : ''}
          {statement.statement_date && <span className="text-muted-foreground"> · {formatDayMonth(statement.statement_date)} statement</span>}
        </p>
      ) : (
        <p className="text-muted-foreground">
          Nothing billed right now
          {statement.next_statement_date ? ` · next statement ${formatDayMonth(statement.next_statement_date)}` : ''}
        </p>
      )}
      {statement.unbilled_spend > 0 && (
        <p className="text-muted-foreground">
          <span className="tabular-nums">{formatMoney(statement.unbilled_spend, statement.currency)}</span> spent since - bills next cycle
        </p>
      )}
    </div>
  );
}

function AccountDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: Account }) {
  const { data: allAccounts = [] } = useAccounts();
  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState<AccountType>(account?.type || 'bank');
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : '0');
  const [currentBalance, setCurrentBalance] = useState('0');
  const [creditLimit, setCreditLimit] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [autopayEnabled, setAutopayEnabled] = useState(false);
  const [autopayAccountId, setAutopayAccountId] = useState('');
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();

  useEffect(() => {
    if (!open) return;
    if (account) {
      setName(account.name);
      setType(account.type);
      setOpening(String(account.opening_balance));
      setCurrentBalance(String(account.type === 'credit' ? -account.current_balance : account.current_balance));
      setCreditLimit(account.credit_limit != null ? String(account.credit_limit) : '');
      setStatementDay(account.statement_day != null ? String(account.statement_day) : '');
      setDueDay(account.due_day != null ? String(account.due_day) : '');
      setAutopayEnabled(account.autopay_enabled);
      setAutopayAccountId(account.autopay_account_id || '');
    } else {
      setName(''); setType('bank'); setOpening('0'); setCurrentBalance('0');
      setCreditLimit(''); setStatementDay(''); setDueDay(''); setAutopayEnabled(false); setAutopayAccountId('');
    }
  }, [open, account]);

  const save = async () => {
    if (!name) { toast.error('Name is required'); return; }
    if (type === 'credit' && autopayEnabled && !autopayAccountId) { toast.error('Pick an account to autopay from'); return; }
    const outOfRange = (v: string) => v !== '' && (Number(v) < 1 || Number(v) > 28);
    if (type === 'credit' && (outOfRange(statementDay) || outOfRange(dueDay))) {
      toast.error('Statement and due days must be between 1 and 28');
      return;
    }
    if (type === 'credit' && autopayEnabled && !dueDay) { toast.error('Autopay needs a due day to pay on'); return; }
    const creditFields = type === 'credit' ? {
      credit_limit: creditLimit ? Number(creditLimit) : null,
      statement_day: statementDay ? Number(statementDay) : null,
      due_day: dueDay ? Number(dueDay) : null,
      autopay_enabled: autopayEnabled,
      autopay_account_id: autopayEnabled ? autopayAccountId : null,
    } : {};
    try {
      if (account) {
        const balancePayload = type === 'credit' ? -Number(currentBalance) : Number(currentBalance);
        await updateAccount.mutateAsync({ id: account.id, payload: { name, type, current_balance: balancePayload, ...creditFields } });
      } else {
        await createAccount.mutateAsync({ name, type, opening_balance: Number(opening), current_balance: Number(opening), ...creditFields });
      }
      toast.success(account ? 'Account updated' : 'Account added');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const archive = async () => {
    if (!account) return;
    await updateAccount.mutateAsync({ id: account.id, payload: { is_archived: true } });
    toast.success('Account archived');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'Add account'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!account ? (
            <div>
              <Label>Opening balance</Label>
              <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label>{type === 'credit' ? 'Current amount owed' : 'Current balance'}</Label>
              <Input type="number" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                Corrects the balance directly - use this to match your real-world {type === 'credit' ? 'card statement' : 'account balance'}, it won't create a transaction.
              </p>
            </div>
          )}
          {type === 'credit' && (
            <div className="space-y-4 rounded-lg border border-border p-3">
              <div>
                <Label>Credit limit</Label>
                <Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="100000" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Statement (billing) day</Label>
                  <Input type="number" min={1} max={28} value={statementDay} onChange={(e) => setStatementDay(e.target.value)} placeholder="1-28" />
                </div>
                <div>
                  <Label>Payment due day</Label>
                  <Input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="1-28" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The statement day closes a billing cycle: everything spent since the previous statement day is what's due on the payment due day.
                Anything swiped after the statement day goes onto next month's bill instead.
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="card-autopay-toggle">Autopay the bill</Label>
                  <p className="text-xs text-muted-foreground">Pays the statement amount from another account on the due day - not the unbilled spend that came after it.</p>
                </div>
                <Switch id="card-autopay-toggle" checked={autopayEnabled} onCheckedChange={setAutopayEnabled} />
              </div>
              {autopayEnabled && (
                <div>
                  <Label>Pay from</Label>
                  <Select value={autopayAccountId} onValueChange={setAutopayAccountId}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {allAccounts.filter((a) => a.id !== account?.id && a.type !== 'credit').map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {account && (
            <Button variant="ghost" className="text-muted-foreground" onClick={archive}>
              <Archive className="mr-2 h-4 w-4" />Archive
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, onOpenChange, accounts, currency }: { open: boolean; onOpenChange: (o: boolean) => void; accounts: Account[]; currency: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const transfer = useTransferFunds();

  const submit = async () => {
    if (!from || !to || !amount) { toast.error('Fill in all fields'); return; }
    if (from === to) { toast.error('Pick two different accounts'); return; }
    try {
      const fromName = accounts.find((a) => a.id === from)?.name ?? 'Account';
      const toName = accounts.find((a) => a.id === to)?.name ?? 'Account';
      await transfer.mutateAsync({ from, to, amount: Number(amount), description: `${fromName} → ${toName}` });
      toast.success('Transferred');
      onOpenChange(false);
      setAmount('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>Transfer between accounts</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>From</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.current_balance, currency)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.id !== from).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={transfer.isPending}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
