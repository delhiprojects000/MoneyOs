import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts, useCreateAccount, useUpdateAccount, useTransferFunds } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney } from '@/lib/format';
import { Plus, Wallet, Landmark, CreditCard, Smartphone, PiggyBank, ArrowLeftRight, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { CardGridSkeleton } from '@/components/skeletons/primitives';
import type { Account, AccountType } from '@/lib/api';

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
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | undefined>(undefined);
  const [transferOpen, setTransferOpen] = useState(false);

  const active = accounts.filter((a) => !a.is_archived);
  const total = active.reduce((s, a) => s + a.current_balance, 0);

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
            return (
              <Card key={a.id} className="hover-lift cursor-pointer" onClick={() => { setEditing(a); setDialogOpen(true); }}>
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${a.color || '#16a34a'}20`, color: a.color || '#16a34a' }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs uppercase text-muted-foreground">{a.type}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.name}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(a.current_balance, a.currency)}</p>
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

function AccountDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: Account }) {
  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState<AccountType>(account?.type || 'bank');
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : '0');
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();

  const save = async () => {
    if (!name) { toast.error('Name is required'); return; }
    try {
      if (account) {
        await updateAccount.mutateAsync({ id: account.id, payload: { name, type } });
      } else {
        await createAccount.mutateAsync({ name, type, opening_balance: Number(opening), current_balance: Number(opening) });
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
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o && !account) { setName(''); setType('bank'); setOpening('0'); } }}>
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
          {!account && (
            <div>
              <Label>Opening balance</Label>
              <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
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
