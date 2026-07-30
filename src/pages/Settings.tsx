import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, colorPalettes, type ColorPalette } from '@/contexts/ThemeContext';
import {
  useCategories, useCreateCategory, useBills, useCreateBill, useUpdateBill,
  useAccounts, useRecurringRules, useCreateRecurringRule, useUpdateRecurringRule,
} from '@/hooks/useMoneyData';
import { auth as authApi, transactions as transactionsApi, type RecurringFrequency } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Sun, Moon, Plus, Download, Check, Repeat } from 'lucide-react';
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
  const { isLoading: billsLoading } = useBills();
  const { isLoading: recurringLoading } = useRecurringRules();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">Your profile, appearance, and categories.</p>
      </div>
      {categoriesLoading || billsLoading || recurringLoading ? <SettingsSkeleton /> : (
        <>
          <ProfileCard />
          <AppearanceCard />
          <CategoriesCard />
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

function CategoriesCard() {
  const { data: expenseCategories = [] } = useCategories('expense');
  const { data: incomeCategories = [] } = useCategories('income');
  const createCategory = useCreateCategory();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categories</CardTitle>
        <CardDescription>Built-in categories plus any custom ones you add.</CardDescription>
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
          <div className="flex flex-wrap gap-1.5">{expenseCategories.map((c) => <Badge key={c.id} variant="outline">{c.name}</Badge>)}</div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Income</p>
          <div className="flex flex-wrap gap-1.5">{incomeCategories.map((c) => <Badge key={c.id} variant="outline">{c.name}</Badge>)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecurringCard() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories('expense');
  const { data: rules = [] } = useRecurringRules();
  const createRule = useCreateRecurringRule();
  const updateRule = useUpdateRecurringRule();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [accountId, setAccountId] = useState('');

  const monthlyTotal = rules
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + (r.frequency === 'monthly' ? r.amount : r.frequency === 'yearly' ? r.amount / 12 : r.frequency === 'weekly' ? r.amount * 4.33 : r.amount * 30), 0);

  const add = async () => {
    if (!name || !amount || !accountId) { toast.error('Fill in all fields'); return; }
    const today = new Date().toISOString().slice(0, 10);
    try {
      await createRule.mutateAsync({
        name, amount: Number(amount), frequency, account_id: accountId,
        category_id: categories[0]?.id, start_date: today, next_run_date: today, type: 'expense',
      });
      setName(''); setAmount('');
      toast.success('Subscription added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateRule.mutateAsync({ id, payload: { is_active: !isActive } });
      toast.success(isActive ? 'Paused' : 'Resumed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subscriptions &amp; recurring</CardTitle>
        <CardDescription>
          Track recurring bills and subscriptions. {monthlyTotal > 0 && <>~{formatMoney(monthlyTotal, currency)}/month across {rules.filter((r) => r.is_active).length} active.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Netflix" className="col-span-3" />
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
          <Select value={frequency} onValueChange={(v) => setFrequency(v as RecurringFrequency)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={add} className="col-span-3"><Plus className="mr-2 h-4 w-4" />Add subscription</Button>
        </div>
        <div className="space-y-1">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <div className={cn('flex items-center gap-2', !r.is_active && 'text-muted-foreground line-through')}>
                <Repeat className="h-3.5 w-3.5" />
                {r.name} - {formatMoney(r.amount, currency)}/{r.frequency}
              </div>
              <Button size="sm" variant="outline" onClick={() => toggleActive(r.id, r.is_active)}>
                {r.is_active ? 'Pause' : 'Resume'}
              </Button>
            </div>
          ))}
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No subscriptions tracked yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function BillsCard() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: bills = [] } = useBills();
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

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
            <div key={b.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <div className={b.is_paid ? 'text-muted-foreground line-through' : ''}>{b.name} - {formatMoney(b.amount, currency)} · due {formatDate(b.due_date)}</div>
              {!b.is_paid && (
                <Button size="sm" variant="outline" onClick={() => updateBill.mutate({ id: b.id, payload: { is_paid: true } })}>Mark paid</Button>
              )}
            </div>
          ))}
          {bills.length === 0 && <p className="text-sm text-muted-foreground">No reminders set.</p>}
        </div>
      </CardContent>
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
