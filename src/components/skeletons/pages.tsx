import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { StatTileGridSkeleton, CardGridSkeleton, ProgressCardGridSkeleton, ListSkeleton, PanelSkeleton, ChartPanelSkeleton } from './primitives';

// One skeleton per page, each roughly mirroring that page's real layout so
// the loading state doesn't feel like a different, jarring screen - the
// header/title/action button still render immediately, only the
// data-dependent body is replaced.

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <StatTileGridSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartPanelSkeleton className="lg:col-span-2" />
        <PanelSkeleton lines={4} />
      </div>
      <Card>
        <CardContent className="space-y-1 p-4 sm:p-6">
          <Skeleton className="mb-2 h-4 w-32" />
          <ListSkeleton count={4} withBadge={false} />
        </CardContent>
      </Card>
    </div>
  );
}

export function TransactionsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 flex-1 min-w-[200px] rounded-md" />
        <Skeleton className="h-10 w-36 rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>
      <div className="space-y-6">
        <div>
          <Skeleton className="mb-2 h-4 w-40" />
          <Card><CardContent className="p-0"><ListSkeleton count={3} /></CardContent></Card>
        </div>
        <div>
          <Skeleton className="mb-2 h-4 w-32" />
          <Card><CardContent className="p-0"><ListSkeleton count={2} /></CardContent></Card>
        </div>
      </div>
    </div>
  );
}

export function AccountsSkeleton() {
  return (
    <div className="space-y-6">
      <CardGridSkeleton count={3} />
    </div>
  );
}

export function BudgetsSkeleton() {
  return <ProgressCardGridSkeleton count={4} />;
}

export function GoalsSkeleton() {
  return <ProgressCardGridSkeleton count={3} />;
}

export function LoansSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReportsSkeleton() {
  return (
    <div className="space-y-6">
      <StatTileGridSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartPanelSkeleton />
        <ChartPanelSkeleton />
      </div>
      <PanelSkeleton lines={4} />
      <PanelSkeleton lines={3} />
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="max-w-2xl space-y-6">
      <PanelSkeleton lines={2} />
      <PanelSkeleton lines={2} />
      <PanelSkeleton lines={3} />
      <PanelSkeleton lines={3} />
      <PanelSkeleton lines={1} />
    </div>
  );
}

export function AuthSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
