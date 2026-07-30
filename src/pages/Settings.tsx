import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, colorPalettes, type ColorPalette } from '@/contexts/ThemeContext';
import {
  useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
  usePaymentMethods, useCreatePaymentMethod, useUpdatePaymentMethod, useDeletePaymentMethod,
  useBills, useCreateBill, useUpdateBill, useDeleteBill,
  useAccounts, useRecurringRules, useCreateRecurringRule, useUpdateRecurringRule, useDeleteRecurringRule, usePostRecurringRule,
} from '@/hooks/useMoneyData';
import { auth as authApi, transactions as transactionsApi, type RecurringFrequency, type Category, type PaymentMethod, type PaymentMethodCategory, type Bill, type RecurringRule } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Sun, Moon, Plus, Download, Check, Repeat, Pencil, Trash2, Zap } from 'lucide-react';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SettingsSkeleton } from '@/components/skeletons/pages';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const PALETTE_LABELS: Record<Exclude<ColorPalette, 'custom'>, string> = {
  emerald: 'Emerald', ocean: 'Ocean', sunset: 'Sunset', violet: 'Violet', rose: 'Rose', slate: 'Slate',
};

export default function Settings() {
  // These are the same queries CategoriesCard/BillsCard/RecurringCard make
  // themselves - calling them here too just reads the shared cache, it
  // doesn't re-fetch, and lets the whole page show one skeleton instead of
  // each card popping in separately.
  const { isLoading: categoriesLoading } = useCategories();
  const { isLoading: paymentMethodsLoading } = usePaymentMethods();
  const { isLoading: billsLoading } = useBills();
  const { isLoading: recurringLoading } = useRecurringRules();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">Your profile, appearance, and categories.</p>
      </div>
      {categoriesLoading || paymentMethodsLoading || billsLoading || recurringLoading ? <SettingsSkeleton /> : (
        <>
          <ProfileCard />
          <AppearanceCard />
          <CategoriesCard />
          <PaymentMethodsCard />
          <RecurringCard />
          <BillsCard />
          <DataExportCard />
        </>
      )}
    </div>
  );
}

function ProfileCard() {
  const { user, refreshUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [currency, setCurrency] = useState(user?.default_currency || 'INR');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await authApi.updateMe({ display_name: displayName, default_currency: currency });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Display name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <Label>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={save} disabled={saving}>Save changes</Button>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, toggleTheme, colorPalette, setColorPalette } = useTheme();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Mode</Label>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            {theme === 'dark' ? <Moon className="mr-2 h-4 w-4" /> : <Sun className="mr-2 h-4 w-4" />}
            {theme === 'dark' ? 'Dark' : 'Light'}
          </Button>
        </div>
        <div>
          <Label className="mb-2 block">Accent color</Label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(colorPalettes) as Array<Exclude<ColorPalette, 'custom'>>).map((p) => (
              <button
                key={p}
                onClick={() => setColorPalette(p)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  colorPalette === p ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `hsl(${colorPalettes[p].primary})` }} />
                {PALETTE_LABELS[p]}
                {colorPalette === p && <Check className="h-3 w-3" />}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EditableChip({ label, canEdit, onEdit, onDelete }: { label: string; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  if (!canEdit) return <Badge variant="outline">{label}</Badge>;
  return (
    <span className="group inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs">
      <button className="hover:underline" onClick={onEdit}>{label}</button>
      <button className="rounded-full p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-destructive hover:opacity-100" onClick={onDelete} title="Delete">
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function CategoriesCard() {
  const { data: expenseCategories = [] } = useCategories('expense');
  const { data: incomeCategories = [] } = useCategories('income');
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<Category | undefined>(undefined);
  const [editName, setEditName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await createCategory.mutateAsync({ name: name.trim(), kind });
      setName('');
      toast.success('Category added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    try {
      await updateCategory.mutateAsync({ id: editing.id, payload: { name: editName.trim() } });
      toast.success('Category renamed');
      setEditing(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const remove = async (c: Category) => {
    try {
      await deleteCategory.mutateAsync(c.id);
      toast.success('Category deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const renderList = (list: Category[]) => (
    <div className="flex flex-wrap gap-1.5">
      {list.map((c) => (
        <EditableChip
          key={c.id}
          label={c.name}
          canEdit={!c.is_system}
          onEdit={() => { setEditing(c); setEditName(c.name); }}
          onDelete={() => remove(c)}
        />
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categories</CardTitle>
        <CardDescription>Built-in categories plus any custom ones you add - click a custom one to rename it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as 'expense' | 'income')}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="expense">Expense</SelectItem><SelectItem value="income">Income</SelectItem></SelectContent>
          </Select>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add}><Plus className="h-4 w-4" /></Button>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Expense</p>
          {renderList(expenseCategories)}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Income</p>
          {renderList(incomeCategories)}
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent {...preventAccidentalDialogClose}>
          <DialogHeader><DialogTitle>Rename category</DialogTitle></DialogHeader>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const PAYMENT_METHOD_CATEGORIES: { value: PaymentMethodCategory; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

function PaymentMethodsCard() {
  const { data: methods = [] } = usePaymentMethods();
  const createMethod = useCreatePaymentMethod();
  const updateMethod = useUpdatePaymentMethod();
  const deleteMethod = useDeletePaymentMethod();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PaymentMethodCategory>('upi');
  const [editing, setEditing] = useState<PaymentMethod | undefined>(undefined);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<PaymentMethodCategory>('upi');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await createMethod.mutateAsync({ name: name.trim(), category });
      setName('');
      toast.success('Payment method added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    try {
      await updateMethod.mutateAsync({ id: editing.id, payload: { name: editName.trim(), category: editCategory } });
      toast.success('Payment method updated');
      setEditing(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const remove = async (pm: PaymentMethod) => {
    try {
      await deleteMethod.mutateAsync(pm.id);
      toast.success('Payment method deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payment methods</CardTitle>
        <CardDescription>Cash, UPI apps, cards - shown when logging a transaction. Add ones we didn't seed by default.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={category} onValueChange={(v) => setCategory(v as PaymentMethodCategory)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_METHOD_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jupiter, Slice" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button onClick={add}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {methods.map((pm) => (
            <EditableChip
              key={pm.id}
              label={pm.name}
              canEdit={!pm.is_system}
              onEdit={() => { setEditing(pm); setEditName(pm.name); setEditCategory(pm.category); }}
              onDelete={() => remove(pm)}
            />
          ))}
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent {...preventAccidentalDialogClose}>
          <DialogHeader><DialogTitle>Edit payment method</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            <Select value={editCategory} onValueChange={(v) => setEditCategory(v as PaymentMethodCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHOD_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RecurringCard() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: rules = [] } = useRecurringRules();
  const updateRule = useUpdateRecurringRule();
  const deleteRule = useDeleteRecurringRule();
  const postRule = usePostRecurringRule();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | undefined>(undefined);
  const [deleting, setDeleting] = useState<RecurringRule | undefined>(undefined);

  const monthlyTotal = rules
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + (r.frequency === 'monthly' ? r.amount : r.frequency === 'yearly' ? r.amount / 12 : r.frequency === 'weekly' ? r.amount * 4.33 : r.amount * 30), 0);

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateRule.mutateAsync({ id, payload: { is_active: !isActive } });
      toast.success(isActive ? 'Paused' : 'Resumed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const markPaid = async (id: string) => {
    try {
      await postRule.mutateAsync(id);
      toast.success('Posted to transactions - next cycle scheduled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRule.mutateAsync(deleting.id);
      toast.success('Subscription removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
    setDeleting(undefined);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Subscriptions &amp; recurring</CardTitle>
          <CardDescription>
            Track recurring bills and subscriptions. {monthlyTotal > 0 && <>~{formatMoney(monthlyTotal, currency)}/month across {rules.filter((r) => r.is_active).length} active.</>}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add</Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <div className={cn('flex min-w-0 items-center gap-2', !r.is_active && 'text-muted-foreground line-through')}>
              <Repeat className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{r.name} - {formatMoney(r.amount, currency)}/{r.frequency}</span>
              {r.auto_post && <Badge variant="secondary" className="shrink-0 gap-1"><Zap className="h-2.5 w-2.5" />Autopay</Badge>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {r.is_active && !r.auto_post && (
                <Button size="sm" variant="outline" onClick={() => markPaid(r.id)} disabled={postRule.isPending}>Mark paid</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => toggleActive(r.id, r.is_active)}>{r.is_active ? 'Pause' : 'Resume'}</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => { setEditing(r); setOpen(true); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setDeleting(r)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions tracked yet.</p>}
      </CardContent>

      <RecurringRuleDialog open={open} onOpenChange={setOpen} rule={editing} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This stops future auto-posting. Transactions it already created stay in your history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function RecurringRuleDialog({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (o: boolean) => void; rule?: RecurringRule }) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories('expense');
  const createRule = useCreateRecurringRule();
  const updateRule = useUpdateRecurringRule();
  const isEdit = !!rule;
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [nextRunDate, setNextRunDate] = useState('');
  const [autoPost, setAutoPost] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setAmount(String(rule.amount));
      setFrequency(rule.frequency);
      setAccountId(rule.account_id);
      setCategoryId(rule.category_id || '');
      setNextRunDate(rule.next_run_date);
      setAutoPost(rule.auto_post);
    } else {
      setName(''); setAmount(''); setFrequency('monthly'); setAccountId(''); setCategoryId('');
      setNextRunDate(new Date().toISOString().slice(0, 10)); setAutoPost(false);
    }
  }, [open, rule]);

  const save = async () => {
    if (!name || !amount || !accountId) { toast.error('Fill in all fields'); return; }
    try {
      if (isEdit) {
        await updateRule.mutateAsync({
          id: rule!.id,
          payload: { name, amount: Number(amount), frequency, account_id: accountId, category_id: categoryId || null, next_run_date: nextRunDate, auto_post: autoPost },
        });
        toast.success('Subscription updated');
      } else {
        const today = new Date().toISOString().slice(0, 10);
        await createRule.mutateAsync({
          name, amount: Number(amount), frequency, account_id: accountId, category_id: categoryId || undefined,
          start_date: today, next_run_date: nextRunDate || today, type: 'expense', auto_post: autoPost,
        });
        toast.success('Subscription added');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit subscription' : 'New subscription'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix" />
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as RecurringFrequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Next due date</Label>
            <Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="autopost-toggle">Autopay</Label>
              <p className="text-xs text-muted-foreground">Post automatically and debit the account when due - no manual "mark paid" needed.</p>
            </div>
            <Switch id="autopost-toggle" checked={autoPost} onCheckedChange={setAutoPost} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={createRule.isPending || updateRule.isPending}>{isEdit ? 'Save changes' : 'Add subscription'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BillsCard() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: bills = [] } = useBills();
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [editing, setEditing] = useState<Bill | undefined>(undefined);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDueDate, setEditDueDate] = useState('');

  const add = async () => {
    if (!name || !amount || !dueDate) { toast.error('Fill in all fields'); return; }
    try {
      await createBill.mutateAsync({ name, amount: Number(amount), due_date: dueDate });
      setName(''); setAmount(''); setDueDate('');
      toast.success('Reminder added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const openEdit = (b: Bill) => {
    setEditing(b); setEditName(b.name); setEditAmount(String(b.amount)); setEditDueDate(b.due_date);
  };

  const saveEdit = async () => {
    if (!editing || !editName || !editAmount || !editDueDate) return;
    try {
      await updateBill.mutateAsync({ id: editing.id, payload: { name: editName, amount: Number(editAmount), due_date: editDueDate } });
      toast.success('Reminder updated');
      setEditing(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteBill.mutateAsync(id);
      toast.success('Reminder deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bill reminders</CardTitle>
        <CardDescription>Standalone due-date reminders, separate from EMIs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Electricity bill" className="col-span-3" />
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="col-span-2" />
          <Button onClick={add} className="col-span-3"><Plus className="mr-2 h-4 w-4" />Add reminder</Button>
        </div>
        <div className="space-y-1">
          {bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <div className={cn('min-w-0 truncate', b.is_paid && 'text-muted-foreground line-through')}>{b.name} - {formatMoney(b.amount, currency)} · due {formatDate(b.due_date)}</div>
              <div className="flex shrink-0 items-center gap-1">
                {!b.is_paid && (
                  <Button size="sm" variant="outline" onClick={() => updateBill.mutate({ id: b.id, payload: { is_paid: true } })}>Mark paid</Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => openEdit(b)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => remove(b.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {bills.length === 0 && <p className="text-sm text-muted-foreground">No reminders set.</p>}
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent {...preventAccidentalDialogClose}>
          <DialogHeader><DialogTitle>Edit reminder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label>Amount</Label>
              <Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function downloadBlob(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Must be attached to the DOM for the click to reliably trigger a
  // download in every browser, and the object URL has to outlive the click
  // handler - revoking it synchronously right after .click() can race with
  // the browser actually starting to read the blob.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

function DataExportCard() {
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  const exportData = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      const all = await transactionsApi.list({ limit: 5000 });
      const dateStamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        downloadBlob(JSON.stringify(all, null, 2), 'application/json', `moneyos-transactions-${dateStamp}.json`);
      } else {
        downloadBlob(toCsv(all as unknown as Array<Record<string, unknown>>), 'text/csv', `moneyos-transactions-${dateStamp}.csv`);
      }
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your data</CardTitle>
        <CardDescription>Export every transaction any time - it's yours.</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button variant="outline" onClick={() => exportData('csv')} disabled={!!exporting}>
          <Download className="mr-2 h-4 w-4" />Export as CSV
        </Button>
        <Button variant="outline" onClick={() => exportData('json')} disabled={!!exporting}>
          <Download className="mr-2 h-4 w-4" />Export as JSON
        </Button>
      </CardContent>
    </Card>
  );
}
