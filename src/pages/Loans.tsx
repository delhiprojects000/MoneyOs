import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLoans, useLoanSchedule, useCreateLoan, usePayLoanInstallment, useAccounts } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDate } from '@/lib/format';
import { Plus, Landmark, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { LoansSkeleton } from '@/components/skeletons/pages';

export default function Loans() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: loans = [], isLoading } = useLoans();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">EMIs &amp; Loans</h1>
          <p className="text-muted-foreground">Track every installment until it's paid off.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add loan</Button>
      </div>

      {isLoading ? <LoansSkeleton /> : (
      <div className="space-y-4">
        {loans.map((l) => (
          <Card key={l.id}>
            <CardContent className="p-5">
              <button className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(expanded === l.id ? undefined : l.id)}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></div>
                  <div>
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{l.lender_name} · {formatMoney(l.emi_amount, currency)}/month</p>
                  </div>
                </div>
                <Badge variant={l.status === 'active' ? 'default' : 'secondary'}>{l.status}</Badge>
              </button>
              {expanded === l.id && <LoanSchedule loanId={l.id} currency={currency} />}
            </CardContent>
          </Card>
        ))}
        {loans.length === 0 && <p className="text-sm text-muted-foreground">No loans tracked yet.</p>}
      </div>
      )}

      <NewLoanDialog open={open} onOpenChange={setOpen} />
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

function NewLoanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts = [] } = useAccounts();
  const createLoan = useCreateLoan();
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [emi, setEmi] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState('');

  const suggestedEmi = () => {
    const p = Number(principal), r = Number(rate) / 12 / 100, n = Number(tenure);
    if (!p || !n) return;
    const e = r === 0 ? p / n : (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    setEmi(e.toFixed(2));
  };

  const save = async () => {
    if (!name || !principal || !tenure || !emi || !accountId) { toast.error('Fill in all required fields'); return; }
    try {
      await createLoan.mutateAsync({
        name, lender_name: lender || undefined, principal_amount: Number(principal), interest_rate: Number(rate) || 0,
        tenure_months: Number(tenure), emi_amount: Number(emi), start_date: startDate, account_id: accountId,
      });
      toast.success('Loan added with full amortization schedule');
      onOpenChange(false);
      setName(''); setLender(''); setPrincipal(''); setRate(''); setTenure(''); setEmi('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>Add a loan / EMI</DialogTitle></DialogHeader>
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
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
          <Button onClick={save} disabled={createLoan.isPending}>Add loan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
