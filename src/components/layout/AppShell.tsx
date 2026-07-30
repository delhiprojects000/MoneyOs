import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Receipt, Wallet, PiggyBank, Target, Landmark, BarChart3, Settings as SettingsIcon,
  Menu, LogOut,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { QuickAddButton } from '@/components/transactions/QuickAddButton';
import { NotificationsBell } from '@/components/layout/NotificationsBell';
import { useProcessDue } from '@/hooks/useMoneyData';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/loans', label: 'EMIs & Loans', icon: Landmark },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = (user?.display_name || user?.username || '?').slice(0, 2).toUpperCase();
  const processDue = useProcessDue();

  // No cron on the VM - catch up any due auto_post subscriptions and settle
  // credit-card autopay once per app load instead. Fire-and-forget; a
  // failure here shouldn't block the UI from rendering.
  useEffect(() => {
    processDue.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border p-4 md:flex">
          <div className="mb-6 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">₹</div>
              <span className="text-lg font-semibold">MoneyOS</span>
            </div>
            <NotificationsBell />
          </div>
          <NavLinks />
          <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">@{user?.username}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">₹</div>
              <span className="font-semibold">MoneyOS</span>
            </div>
            <div className="flex items-center gap-1">
            <NotificationsBell />
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-4">
                <div className="mb-6 flex items-center gap-2 px-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">₹</div>
                  <span className="text-lg font-semibold">MoneyOS</span>
                </div>
                <NavLinks onNavigate={() => setMobileOpen(false)} />
                <Button variant="ghost" className="mt-6 w-full justify-start gap-3 text-muted-foreground" onClick={signOut}>
                  <LogOut className="h-4 w-4" /> Sign out
                </Button>
              </SheetContent>
            </Sheet>
            </div>
          </header>

          <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Floating quick-add, available everywhere */}
      <div className="fixed bottom-6 right-6 z-40">
        <QuickAddButton />
      </div>
    </div>
  );
}
