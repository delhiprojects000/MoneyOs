/**
 * Profile, appearance, categories, payment methods, and data export.
 *
 * @module settings
 */
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, colorPalettes, type ColorPalette } from '@/contexts/ThemeContext';
import {
  useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
  usePaymentMethods, useCreatePaymentMethod, useUpdatePaymentMethod, useDeletePaymentMethod,
} from '@/hooks/useMoneyData';
import { auth as authApi, transactions as transactionsApi, type Category, type PaymentMethod, type PaymentMethodCategory } from '@/lib/api';
import { Sun, Moon, Plus, Download, Check, Trash2 } from 'lucide-react';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SettingsSkeleton } from '@/components/skeletons/pages';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const PALETTE_LABELS: Record<Exclude<ColorPalette, 'custom'>, string> = {
  emerald: 'Emerald', ocean: 'Ocean', sunset: 'Sunset', violet: 'Violet', rose: 'Rose', slate: 'Slate',
};

export default function Settings() {
  // Reads the shared query cache rather than re-fetching, so the page shows
  // one skeleton instead of each card popping in separately.
  const { isLoading: categoriesLoading } = useCategories();
  const { isLoading: paymentMethodsLoading } = usePaymentMethods();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">Your profile, appearance, and categories.</p>
      </div>
      {categoriesLoading || paymentMethodsLoading ? <SettingsSkeleton /> : (
        <>
          <ProfileCard />
          <AppearanceCard />
          <CategoriesCard />
          <PaymentMethodsCard />
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

function downloadBlob(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // The anchor must be in the DOM for the click to fire everywhere, and the
  // object URL must outlive the handler: revoking it synchronously races the
  // browser starting to read the blob.
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
