/**
 * Every recurring obligation: EMIs with amortisation schedules, subscriptions, and standalone bill reminders.
 *
 * @module loans
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useLoans, useLoanSchedule, useCreateLoan, useUpdateLoan, useDeleteLoan, usePayLoanInstallment, useAccounts, usePendingLoanPayments,
  useCategories, useRecurringRules, useCreateRecurringRule, useUpdateRecurringRule, useDeleteRecurringRule, usePostRecurringRule,
  useBills, useCreateBill, useUpdateBill, useDeleteBill,
} from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDate, formatRelativeDay, formatCyclePeriod } from '@/lib/format';
import { daysUntil } from '@/lib/upcoming';
import { Plus, Landmark, CheckCircle2, Pencil, Trash2, Repeat, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose, cn } from '@/lib/utils';
import { LoansSkeleton } from '@/components/skeletons/pages';
import type { Loan, RecurringFrequency, RecurringRule, Bill } from '@/lib/api';

export default function Loans() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">EMIs &amp; Bills</h1>
        <p className="text-muted-foreground">Loans, subscriptions, and bill reminders - all your recurring obligations in one place.</p>
      </div>

      <Tabs defaultValue="loans">
        <TabsList>
          <TabsTrigger value="loans">EMIs &amp; Loans</TabsTrigger>
          <TabsTrigger value="recurring">Subscriptions</TabsTrigger>
          <TabsTrigger value="bills">Bill reminders</TabsTrigger>
        </TabsList>
        <TabsContent value="loans" className="mt-4"><LoansTab /></TabsContent>
        <TabsContent value="recurring" className="mt-4"><RecurringTab /></TabsContent>
        <TabsContent value="bills" className="mt-4"><BillsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// --- EMIs & Loans ------------------------------------------------------

function LoansTab() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: loans = [], isLoading } = useLoans();
  const { data: pendingPayments = [] } = usePendingLoanPayments();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | undefined>(undefined);
  const [deleting, setDeleting] = useState<Loan | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const deleteLoan = useDeleteLoan();

  // Earliest pending instalment per loan, so a schedule change is visible on
  // the collapsed card without expanding it.
  const nextDueByLoan = useMemo(() => {
    const map = new Map<string, (typeof pendingPayments)[number]>();
    for (const p of pendingPayments) if (!map.has(p.loan_id)) map.set(p.loan_id, p);
    return map;
  }, [pendingPayments]);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteLoan.mutateAsync(deleting.id);
      toast.success('Loan deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
    setDeleting(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add loan</Button>
      </div>

      {isLoading ? <LoansSkeleton /> : (
      <div className="space-y-4">
        {loans.map((l) => {
          const nextDue = nextDueByLoan.get(l.id);
          return (
          <Card key={l.id}>
            <CardContent className="p-5">
              <div className="flex w-full items-center justify-between">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setExpanded(expanded === l.id ? undefined : l.id)}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></div>
                  <div>
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{l.lender_name} · {formatMoney(l.emi_amount, currency)}/month</p>
                    {nextDue ? (
                      <p className="mt-0.5 text-xs">
                        Next due <span className="font-medium">{formatRelativeDay(nextDue.due_date)}</span> · {formatMoney(nextDue.principal_component + nextDue.interest_component, currency)}
                      </p>
                    ) : l.status === 'active' ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">No pending installments</p>
                    ) : null}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <Badge variant={l.status === 'active' ? 'default' : 'secondary'} className="mr-1">{l.status}</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => { setEditing(l); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setDeleting(l)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {expanded === l.id && <LoanSchedule loanId={l.id} currency={currency} />}
            </CardContent>
          </Card>
          );
        })}
        {loans.length === 0 && <p className="text-sm text-muted-foreground">No loans tracked yet.</p>}
      </div>
      )}

      <NewLoanDialog open={open} onOpenChange={setOpen} loan={editing} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This removes the loan and its entire installment schedule, including paid installments' records (their transactions stay in your history). This can't be undone.</AlertDialogDescription>
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

function LoanSchedule({ loanId, currency }: { loanId: string; currency: string }) {
  const { data: schedule = [] } = useLoanSchedule(loanId);
  const payInstallment = usePayLoanInstallment();
  const paid = schedule.filter((p) => p.status === 'paid').length;

  const pay = async (paymentId: string) => {
    try {
      await payInstallment.mutateAsync({ loanId, paymentId });
      toast.success('Installment paid');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-3 text-sm text-muted-foreground">{paid} of {schedule.length} installments paid</p>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {schedule.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <div className="flex items-center gap-2">
              <span className="w-6 text-muted-foreground">#{p.installment_number}</span>
              <span>{formatDate(p.due_date)}</span>
              {p.status === 'paid' && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{formatMoney(p.principal_component + p.interest_component, currency)}</span>
              {p.status !== 'paid' ? (
                <Button size="sm" variant="outline" onClick={() => pay(p.id)} disabled={payInstallment.isPending}>Mark paid</Button>
              ) : (
                <span className="w-[88px] text-right text-xs text-muted-foreground">Paid</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewLoanDialog({ open, onOpenChange, loan }: { open: boolean; onOpenChange: (o: boolean) => void; loan?: Loan }) {
  const { data: accounts = [] } = useAccounts();
  const { data: schedule = [] } = useLoanSchedule(loan?.id);
  const createLoan = useCreateLoan();
  const updateLoan = useUpdateLoan();
  const isEdit = !!loan;
  const hasPaidInstallments = isEdit && schedule.some((p) => p.status === 'paid');
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [emi, setEmi] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    if (!open) return;
    if (loan) {
      setName(loan.name);
      setLender(loan.lender_name || '');
      setPrincipal(String(loan.principal_amount));
      setRate(String(loan.interest_rate));
      setTenure(String(loan.tenure_months));
      setEmi(String(loan.emi_amount));
      setStartDate(loan.start_date);
      setAccountId(loan.account_id);
    } else {
      setName(''); setLender(''); setPrincipal(''); setRate(''); setTenure(''); setEmi('');
      setStartDate(new Date().toISOString().slice(0, 10)); setAccountId('');
    }
  }, [open, loan]);

  const suggestedEmi = () => {
    const p = Number(principal), r = Number(rate) / 12 / 100, n = Number(tenure);
    if (!p || !n) return;
    const e = r === 0 ? p / n : (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    setEmi(e.toFixed(2));
  };

  const save = async () => {
    if (!name || !principal || !tenure || !emi || !accountId) { toast.error('Fill in all required fields'); return; }
    try {
      if (isEdit) {
        await updateLoan.mutateAsync({
          id: loan!.id,
          payload: {
            name, lender_name: lender || undefined, principal_amount: Number(principal), interest_rate: Number(rate) || 0,
            tenure_months: Number(tenure), emi_amount: Number(emi), start_date: startDate, account_id: accountId,
          },
        });
        toast.success('Loan updated - unpaid installments were recalculated');
      } else {
        await createLoan.mutateAsync({
          name, lender_name: lender || undefined, principal_amount: Number(principal), interest_rate: Number(rate) || 0,
          tenure_months: Number(tenure), emi_amount: Number(emi), start_date: startDate, account_id: accountId,
        });
        toast.success('Loan added with full amortization schedule');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit loan / EMI' : 'Add a loan / EMI'}</DialogTitle></DialogHeader>
        {isEdit && <p className="text-xs text-muted-foreground">Changing the amount, rate, tenure, or EMI recalculates every installment that isn't paid yet - already-paid ones are untouched.</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Loan name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone EMI" />
          </div>
          <div className="col-span-2">
            <Label>Lender (optional)</Label>
            <Input value={lender} onChange={(e) => setLender(e.target.value)} placeholder="Bajaj Finserv" />
          </div>
          <div>
            <Label>Principal amount</Label>
            <Input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </div>
          <div>
            <Label>Annual interest rate %</Label>
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0 if none" />
          </div>
          <div>
            <Label>Tenure (months)</Label>
            <Input type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} />
          </div>
          <div>
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={hasPaidInstallments} />
            {hasPaidInstallments && <p className="mt-1 text-xs text-muted-foreground">Locked - the schedule already continues from your last paid installment, so this can't move anymore.</p>}
          </div>
          <div className="col-span-2 flex items-end gap-2">
            <div className="flex-1">
              <Label>Monthly EMI amount</Label>
              <Input type="number" value={emi} onChange={(e) => setEmi(e.target.value)} />
            </div>
            <Button type="button" variant="outline" onClick={suggestedEmi}>Suggest</Button>
          </div>
          <div className="col-span-2">
            <Label>Debit from account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={createLoan.isPending || updateLoan.isPending}>{isEdit ? 'Save changes' : 'Add loan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Subscriptions & recurring ------------------------------------------

function RecurringTab() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: rules = [] } = useRecurringRules();
  const updateRule = useUpdateRecurringRule();
  const deleteRule = useDeleteRecurringRule();
  const postRule = usePostRecurringRule();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | undefined>(undefined);
  const [deleting, setDeleting] = useState<RecurringRule | undefined>(undefined);
  // Which row is mid-post, so one shared mutation does not disable every row.
  const [posting, setPosting] = useState<string | undefined>(undefined);

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

  // The cycle travels with the request so the server can reject a stale one.
  const markPaid = async (rule: RecurringRule) => {
    if (posting) return;
    setPosting(rule.id);
    try {
      await postRule.mutateAsync({ id: rule.id, period: rule.next_run_date });
      toast.success(`Marked paid for ${formatCyclePeriod(rule.frequency, rule.next_run_date)} - next cycle scheduled`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPosting(undefined);
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
        {rules.map((r) => {
          const overdue = r.is_active && daysUntil(r.next_run_date) < 0;
          return (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <div className={cn('flex min-w-0 flex-1 items-center gap-2', !r.is_active && 'text-muted-foreground line-through')}>
              <Repeat className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">{r.name} - {formatMoney(r.amount, currency)}/{r.frequency}</p>
                {r.last_posted_period && (
                  <p className="truncate text-xs text-muted-foreground">Last paid for {formatCyclePeriod(r.frequency, r.last_posted_period)}</p>
                )}
              </div>
              {r.auto_post && <Badge variant="secondary" className="shrink-0 gap-1"><Zap className="h-2.5 w-2.5" />Autopay</Badge>}
            </div>
            {/* Which cycle the next payment covers - "Aug 2026", not just a
                date - so it's obvious whether a click already registered. */}
            <div className="w-32 shrink-0 text-right sm:w-36">
              {r.is_active ? (
                <>
                  <p className="truncate text-xs text-muted-foreground">
                    Due for <span className={cn('font-medium text-foreground', overdue && 'text-destructive')}>{formatCyclePeriod(r.frequency, r.next_run_date)}</span>
                  </p>
                  <p className={cn('truncate text-[11px] text-muted-foreground', overdue && 'text-destructive')}>{formatRelativeDay(r.next_run_date)}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Paused</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {r.is_active && !r.auto_post && (
                <Button size="sm" variant="outline" onClick={() => markPaid(r)} disabled={!!posting}>
                  {posting === r.id ? 'Posting...' : 'Mark paid'}
                </Button>
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
          );
        })}
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

// --- Bill reminders -------------------------------------------------------

function BillsTab() {
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
