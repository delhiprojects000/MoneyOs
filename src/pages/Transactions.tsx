/**
 * The full ledger, with search and filters by type, account and category.
 *
 * @module transactions
 */
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAccounts, useCategories, useDeleteTransaction, useTransactions } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDateTime } from '@/lib/format';
import { Plus, Search, Trash2, Pencil } from 'lucide-react';
import { TransactionDialog } from '@/components/transactions/TransactionDialog';
import { ListSkeleton } from '@/components/skeletons/primitives';
import { toast } from 'sonner';
import type { Transaction } from '@/lib/api';

export default function TransactionsPage() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined);
  const [deletingTx, setDeletingTx] = useState<Transaction | undefined>(undefined);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: transactions = [], isLoading } = useTransactions({
    account_id: accountFilter !== 'all' ? accountFilter : undefined,
    category_id: categoryFilter !== 'all' ? categoryFilter : undefined,
    type: typeFilter !== 'all' ? (typeFilter as Transaction['type']) : undefined,
    search: search || undefined,
    limit: 200,
  });
  const deleteTx = useDeleteTransaction();

  const accountName = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categoryName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);

  const grouped = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    for (const t of transactions) {
      const day = t.occurred_at.slice(0, 10);
      groups[day] ??= [];
      groups[day].push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [transactions]);

  const confirmDelete = async () => {
    if (!deletingTx) return;
    try {
      await deleteTx.mutateAsync(deletingTx.id);
      toast.success('Transaction deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
    setDeletingTx(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Button onClick={() => { setEditingTx(undefined); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add transaction</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search description..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="transfer">Transfer</SelectItem>
          </SelectContent>
        </Select>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Account" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <ListSkeleton count={6} withBadge={false} />}
      {!isLoading && grouped.length === 0 && <p className="text-sm text-muted-foreground">No transactions match these filters.</p>}

      <div className="space-y-6">
        {!isLoading && grouped.map(([day, txs]) => (
          <div key={day}>
            <p className="mb-2 text-sm font-medium text-muted-foreground">{new Date(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {txs.map((t) => (
                  <div key={t.id} className="group flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{t.description || (t.type === 'transfer' ? 'Transfer' : 'Untitled')}</p>
                        {t.is_group_expense && <Badge variant="secondary">Group</Badge>}
                        {t.category_id && categoryName[t.category_id] && <Badge variant="outline">{categoryName[t.category_id]}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {accountName[t.account_id]} · {formatDateTime(t.occurred_at).split(',').slice(1).join(',').trim()}
                        {t.tags?.length > 0 && ` · ${t.tags.join(', ')}`}
                      </p>
                    </div>
                    <span className={`shrink-0 tabular-nums font-medium ${t.type === 'income' ? 'text-success' : t.type === 'expense' ? 'text-destructive' : ''}`}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{formatMoney(t.amount, currency)}
                    </span>
                    <div className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingTx(t); setDialogOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeletingTx(t)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <TransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} transaction={editingTx} />

      <AlertDialog open={!!deletingTx} onOpenChange={(o) => !o && setDeletingTx(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>This will reverse its effect on the account balance. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
