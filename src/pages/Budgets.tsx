/**
 * Per-category monthly spending limits and progress against them.
 *
 * @module budgets
 */
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBudgets, useCategories, useCreateBudget, useUpdateBudget, useDeleteBudget, useReportsSummary } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney } from '@/lib/format';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { ProgressCardGridSkeleton } from '@/components/skeletons/primitives';
import type { Budget, BudgetPeriod } from '@/lib/api';

export default function Budgets() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: budgets = [], isLoading } = useBudgets();
  const { data: categories = [] } = useCategories('expense');
  const { data: summary } = useReportsSummary('month');
  const deleteBudget = useDeleteBudget();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | undefined>(undefined);

  const categoryName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const spentByCategory = summary?.by_category ?? {};
  const overallSpent = summary?.totals.expense ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Budgets</h1>
          <p className="text-muted-foreground">Set limits and watch spend stay in line.</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />New budget</Button>
      </div>

      {isLoading ? <ProgressCardGridSkeleton count={4} /> : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {budgets.filter((b) => b.is_active).map((b) => {
          const spent = b.category_id ? (spentByCategory[b.category_id] || 0) : overallSpent;
          const pct = Math.min(100, Math.round((spent / b.amount_limit) * 100));
          const over = spent > b.amount_limit;
          return (
            <Card key={b.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="font-medium">{b.category_id ? categoryName[b.category_id] || 'Category' : 'Overall spending'}</p>
                    <p className="text-xs capitalize text-muted-foreground">{b.period}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => { setEditing(b); setOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => deleteBudget.mutate(b.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <Progress value={pct} className={over ? '[&>div]:bg-destructive' : ''} />
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className={over ? 'font-medium text-destructive' : 'text-muted-foreground'}>{formatMoney(spent, currency)} spent</span>
                  <span className="text-muted-foreground">of {formatMoney(b.amount_limit, currency)}</span>
                </div>
                {over && <p className="mt-1 text-xs text-destructive">Over budget by {formatMoney(spent - b.amount_limit, currency)}</p>}
              </CardContent>
            </Card>
          );
        })}
        {budgets.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No budgets yet - set one to keep spending on track.</p>}
      </div>
      )}

      <NewBudgetDialog open={open} onOpenChange={setOpen} budget={editing} />
    </div>
  );
}

function NewBudgetDialog({ open, onOpenChange, budget }: { open: boolean; onOpenChange: (o: boolean) => void; budget?: Budget }) {
  const { data: categories = [] } = useCategories('expense');
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const isEdit = !!budget;
  const [categoryId, setCategoryId] = useState('overall');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!open) return;
    if (budget) {
      setCategoryId(budget.category_id || 'overall');
      setPeriod(budget.period);
      setAmount(String(budget.amount_limit));
    } else {
      setCategoryId('overall');
      setPeriod('monthly');
      setAmount('');
    }
  }, [open, budget]);

  const save = async () => {
    if (!amount) { toast.error('Enter an amount'); return; }
    try {
      if (isEdit) {
        await updateBudget.mutateAsync({
          id: budget!.id,
          payload: { category_id: categoryId === 'overall' ? null : categoryId, period, amount_limit: Number(amount) },
        });
        toast.success('Budget updated');
      } else {
        await createBudget.mutateAsync({
          category_id: categoryId === 'overall' ? undefined : categoryId,
          period,
          amount_limit: Number(amount),
          start_date: new Date().toISOString().slice(0, 10),
        });
        toast.success('Budget created');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit budget' : 'New budget'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="overall">Overall spending</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Limit amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={createBudget.isPending || updateBudget.isPending}>{isEdit ? 'Save changes' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
