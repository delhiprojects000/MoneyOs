import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TransactionDialog } from './TransactionDialog';

export function QuickAddButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="lg" className="h-14 w-14 rounded-full shadow-lg" onClick={() => setOpen(true)}>
        <Plus className="h-6 w-6" />
      </Button>
      {open && <TransactionDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
