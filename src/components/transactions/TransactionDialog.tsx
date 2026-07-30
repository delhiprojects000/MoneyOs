import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccounts, useCategories, usePaymentMethods, useCreateTransaction, useUpdateTransaction } from '@/hooks/useMoneyData';
import { toDatetimeLocalValue } from '@/lib/format';
import { upload, type Transaction, type TransactionType } from '@/lib/api';
import { preventAccidentalDialogClose } from '@/lib/utils';
import { toast } from 'sonner';
import { Paperclip, Loader2 } from 'lucide-react';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: Transaction;
  defaultAccountId?: string;
}

export function TransactionDialog({ open, onOpenChange, transaction, defaultAccountId }: TransactionDialogProps) {
  const { data: accounts = [] } = useAccounts();
  const isEdit = !!transaction;

  const [type, setType] = useState<TransactionType>('expense');
  const [accountId, setAccountId] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [occurredAt, setOccurredAt] = useState(toDatetimeLocalValue());
  const [tags, setTags] = useState('');
  const [isGroup, setIsGroup] = useState(false);
  const [groupReason, setGroupReason] = useState('');
  const [groupTotal, setGroupTotal] = useState('');
  const [groupCount, setGroupCount] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

  const { data: categories = [] } = useCategories(type === 'income' ? 'income' : 'expense');
  const { data: paymentMethods = [] } = usePaymentMethods();
  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();

  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setType(transaction.type);
      setAccountId(transaction.account_id);
      setTransferToId(transaction.transfer_to_account_id || '');
      setCategoryId(transaction.category_id || '');
      setPaymentMethodId(transaction.payment_method_id || '');
      setAmount(String(transaction.amount));
      setDescription(transaction.description);
      setNotes(transaction.notes || '');
      setOccurredAt(toDatetimeLocalValue(transaction.occurred_at));
      setTags((transaction.tags || []).join(', '));
      setIsGroup(transaction.is_group_expense);
      setGroupReason(transaction.group_reason || '');
      setGroupTotal(transaction.group_total_amount ? String(transaction.group_total_amount) : '');
      setGroupCount(transaction.group_participant_count ? String(transaction.group_participant_count) : '');
      setAttachmentUrl(transaction.attachment_url || undefined);
    } else {
      setType('expense');
      setAccountId(defaultAccountId || accounts[0]?.id || '');
      setTransferToId('');
      setCategoryId('');
      setPaymentMethodId('');
      setAmount('');
      setDescription('');
      setNotes('');
      setOccurredAt(toDatetimeLocalValue());
      setTags('');
      setIsGroup(false);
      setGroupReason('');
      setGroupTotal('');
      setGroupCount('');
      setAttachmentUrl(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await upload.receipt(file);
      setAttachmentUrl(url);
      toast.success('Receipt attached');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!accountId || !amount) {
      toast.error('Account and amount are required');
      return;
    }
    if (type === 'transfer' && !transferToId) {
      toast.error('Pick a destination account');
      return;
    }

    const payload = {
      account_id: accountId,
      transfer_to_account_id: type === 'transfer' ? transferToId : undefined,
      category_id: categoryId || undefined,
      payment_method_id: paymentMethodId || undefined,
      type,
      amount: Number(amount),
      description,
      notes: notes || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      occurred_at: new Date(occurredAt).toISOString(),
      attachment_url: attachmentUrl,
      is_group_expense: isGroup,
      group_reason: isGroup ? groupReason : undefined,
      group_total_amount: isGroup && groupTotal ? Number(groupTotal) : undefined,
      group_participant_count: isGroup && groupCount ? Number(groupCount) : undefined,
    };

    try {
      if (isEdit) {
        await updateTx.mutateAsync({ id: transaction!.id, payload });
        toast.success('Transaction updated');
      } else {
        await createTx.mutateAsync(payload);
        toast.success('Transaction added');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const saving = createTx.isPending || updateTx.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" {...preventAccidentalDialogClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
        </DialogHeader>

        <Tabs value={type} onValueChange={(v) => setType(v as TransactionType)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="expense">Expense</TabsTrigger>
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Amount</Label>
            <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>

          <div>
            <Label>{type === 'transfer' ? 'From account' : 'Account'}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {type === 'transfer' ? (
            <div>
              <Label>To account</Label>
              <Select value={transferToId} onValueChange={setTransferToId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => a.id !== accountId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {type !== 'transfer' && (
            <div className="col-span-2">
              <Label>Payment method</Label>
              <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
                <SelectTrigger><SelectValue placeholder="Cash, UPI app, card..." /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((pm) => <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="col-span-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this for?" />
          </div>

          <div className="col-span-2">
            <Label>Date &amp; time</Label>
            <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>

          <div className="col-span-2">
            <Label>Tags (comma separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="trip-goa, work" />
          </div>

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="col-span-2">
            <Label className="mb-1 block">Receipt</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              {attachmentUrl ? 'Receipt attached — tap to replace' : 'Attach a photo'}
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>

          {type === 'expense' && (
            <div className="col-span-2 space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="group-toggle">Group expense (split with others)</Label>
                <Switch id="group-toggle" checked={isGroup} onCheckedChange={setIsGroup} />
              </div>
              {isGroup && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>What was it for?</Label>
                    <Input value={groupReason} onChange={(e) => setGroupReason(e.target.value)} placeholder="Friend's birthday dinner" />
                  </div>
                  <div>
                    <Label>Total bill amount</Label>
                    <Input type="number" value={groupTotal} onChange={(e) => setGroupTotal(e.target.value)} placeholder="1000" />
                  </div>
                  <div>
                    <Label>Number of people</Label>
                    <Input type="number" value={groupCount} onChange={(e) => setGroupCount(e.target.value)} placeholder="4" />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    Only your share (the Amount field above) is subtracted from your account — the total and headcount are kept just for reporting.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add transaction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
