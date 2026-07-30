import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Reminder keys already embed the specific due date/occurrence (see
// buildUpcomingItems), so persisting a plain set of dismissed keys is enough
// to "swipe away" one - once the underlying due date moves to the next
// cycle, the key changes and it naturally reappears. Capped so a long-lived
// account doesn't grow this unboundedly in localStorage.
const MAX_ENTRIES = 300;

function storageKey(userId: string) {
  return `moneyos_dismissed_reminders_${userId}`;
}

function load(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(userId: string, keys: Set<string>) {
  const arr = [...keys].slice(-MAX_ENTRIES);
  localStorage.setItem(storageKey(userId), JSON.stringify(arr));
}

export function useDismissedReminders() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (user?.id) setDismissed(load(user.id));
  }, [user?.id]);

  const dismiss = useCallback((key: string) => {
    if (!user?.id) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      save(user.id, next);
      return next;
    });
  }, [user?.id]);

  const dismissAll = useCallback((keys: string[]) => {
    if (!user?.id) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      save(user.id, next);
      return next;
    });
  }, [user?.id]);

  const isDismissed = useCallback((key: string) => dismissed.has(key), [dismissed]);

  return { isDismissed, dismiss, dismissAll };
}
