import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from '@/hooks/useMoneyData';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, formatDate } from '@/lib/format';
import { Plus, Trash2, Target, PartyPopper } from 'lucide-react';
import { toast } from 'sonner';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { ProgressCardGridSkeleton } from '@/components/skeletons/primitives';
import type { Goal } from '@/lib/api';

function monthsUntil(dateStr: string | null): number {
  if (!dateStr) return 0;
  const now = new Date();
  const target = new Date(dateStr);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30)));
}

export default function Goals() {
  const { user } = useAuth();
  const currency = user?.default_currency || 'INR';
  const { data: goals = [], isLoading } = useGoals();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const [open, setOpen] = useState(false);
  const [contributingTo, setContributingTo] = useState<Goal | undefined>(undefined);
  const [contribution, setContribution] = useState('');

  const addContribution = async () => {
    if (!contributingTo || !contribution) return;
    const newAmount = contributingTo.current_amount + Number(contribution);
    await updateGoal.mutateAsync({
      id: contributingTo.id,
      payload: { current_amount: newAmount, status: newAmount >= contributingTo.target_amount ? 'completed' : 'active' },
    });
    if (newAmount >= contributingTo.target_amount) toast.success('Goal reached! 🎉');
    else toast.success('Contribution added');
    setContributingTo(undefined);
    setContribution('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Goals</h1>
          <p className="text-muted-foreground">Save toward what matters.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New goal</Button>
      </div>

      {isLoading ? <ProgressCardGridSkeleton count={3} className="lg:!grid-cols-3" /> : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {goals.map((g) => {
          const pct = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
          const remaining = Math.max(0, g.target_amount - g.current_amount);
          const months = monthsUntil(g.target_date);
          const suggested = g.status === 'active' && g.target_date ? Math.ceil(remaining / months) : 0;
          return (
            <Card key={g.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {g.status === 'completed' ? <PartyPopper className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="font-medium">{g.name}</p>
                      {g.target_date && <p className="text-xs text-muted-foreground">by {formatDate(g.target_date)}</p>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => deleteGoal.mutate(g.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Progress value={pct} />
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{formatMoney(g.current_amount, currency)}</span>
                  <span className="text-muted-foreground">of {formatMoney(g.target_amount, currency)}</span>
                </div>
                {g.status === 'completed' ? (
                  <p className="mt-2 text-xs font-medium text-success">Goal reached! 🎉</p>
                ) : (
                  <>
                    {suggested > 0 && <p className="mt-1 text-xs text-muted-foreground">~{formatMoney(suggested, currency)}/month to hit your date</p>}
                    <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setContributingTo(g)}>Add contribution</Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
        {goals.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No goals yet - set one to start saving with a plan.</p>}
      </div>
      )}

      <NewGoalDialog open={open} onOpenChange={setOpen} />

      <Dialog open={!!contributingTo} onOpenChange={(o) => !o && setContributingTo(undefined)}>
        <DialogContent {...preventAccidentalDialogClose}>
          <DialogHeader><DialogTitle>Add to "{contributingTo?.name}"</DialogTitle></DialogHeader>
          <Input type="number" value={contribution} onChange={(e) => setContribution(e.target.value)} placeholder="Amount" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setContributingTo(undefined)}>Cancel</Button>
            <Button onClick={addContribution}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewGoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createGoal = useCreateGoal();
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const save = async () => {
    if (!name || !targetAmount) { toast.error('Name and target amount are required'); return; }
    try {
      await createGoal.mutateAsync({ name, target_amount: Number(targetAmount), target_date: targetDate || undefined });
      toast.success('Goal created');
      onOpenChange(false);
      setName(''); setTargetAmount(''); setTargetDate('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...preventAccidentalDialogClose}>
        <DialogHeader><DialogTitle>New goal</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund" />
          </div>
          <div>
            <Label>Target amount</Label>
            <Input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="100000" />
          </div>
          <div>
            <Label>Target date (optional)</Label>
            <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
