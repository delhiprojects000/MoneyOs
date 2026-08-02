import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  accounts, categories, paymentMethods, transactions, loans, budgets, goals, bills, recurringRules, reports, processDue, creditCards,
  type CreateTransactionInput, type CreateLoanInput, type Account, type Category, type PaymentMethod, type Budget, type Goal, type Bill, type RecurringRule,
} from '@/lib/api';

// Invalidate both accounts (balances change) and transactions/reports after
// any write that could move money - simpler than threading fine-grained
// invalidation through every call site.
function useMoneyMutationInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['loans'] });
    // Card statements are derived from balances + transactions, so any money
    // movement can change what's billed or still unbilled on a card.
    qc.invalidateQueries({ queryKey: ['credit-card-statements'] });
  };
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: accounts.list });
}

// Per-card statement cycle (what's billed, what's still unbilled, when it's
// due) - computed server-side so the dashboard, notifications bell, and
// accounts page can't drift apart on the same card's bill.
export function useCreditCardStatements() {
  return useQuery({ queryKey: ['credit-card-statements'], queryFn: creditCards.statements });
}

export function useCategories(kind?: 'expense' | 'income') {
  return useQuery({ queryKey: ['categories', kind], queryFn: () => categories.list(kind) });
}

export function usePaymentMethods() {
  return useQuery({ queryKey: ['payment_methods'], queryFn: paymentMethods.list });
}

export function useCreatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PaymentMethod>) => paymentMethods.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment_methods'] }),
  });
}

export function useUpdatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<PaymentMethod> }) => paymentMethods.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment_methods'] }),
  });
}

export function useDeletePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentMethods.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment_methods'] }),
  });
}

export function useTransactions(params: Parameters<typeof transactions.list>[0] = {}) {
  return useQuery({ queryKey: ['transactions', params], queryFn: () => transactions.list(params) });
}

export function useCreateTransaction() {
  const invalidate = useMoneyMutationInvalidation();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) => transactions.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useMoneyMutationInvalidation();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateTransactionInput> }) => transactions.update(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useMoneyMutationInvalidation();
  return useMutation({
    mutationFn: (id: string) => transactions.remove(id),
    onSuccess: invalidate,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Account>) => accounts.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Account> }) => accounts.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['credit-card-statements'] });
    },
  });
}

export function useTransferFunds() {
  const invalidate = useMoneyMutationInvalidation();
  return useMutation({
    mutationFn: ({ from, to, amount, description }: { from: string; to: string; amount: number; description?: string }) =>
      accounts.transfer(from, to, amount, description),
    onSuccess: invalidate,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Category>) => categories.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Category> }) => categories.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => categories.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useLoans() {
  return useQuery({ queryKey: ['loans'], queryFn: loans.list });
}

export function useLoanSchedule(loanId: string | undefined) {
  return useQuery({ queryKey: ['loan-schedule', loanId], queryFn: () => loans.schedule(loanId!), enabled: !!loanId });
}

export function usePendingLoanPayments() {
  return useQuery({ queryKey: ['loan-payments-pending'], queryFn: loans.pendingPayments });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateLoanInput) => loans.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loans'] }),
  });
}

export function useUpdateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateLoanInput> }) => loans.update(id, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loan-schedule', vars.id] });
      qc.invalidateQueries({ queryKey: ['loan-payments-pending'] });
    },
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => loans.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loan-payments-pending'] });
    },
  });
}

export function usePayLoanInstallment() {
  const invalidate = useMoneyMutationInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, paymentId }: { loanId: string; paymentId: string }) => loans.payInstallment(loanId, paymentId),
    onSuccess: (_data, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['loan-schedule', vars.loanId] });
      qc.invalidateQueries({ queryKey: ['loan-payments-pending'] });
    },
  });
}

export function useBudgets() {
  return useQuery({ queryKey: ['budgets'], queryFn: budgets.list });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Budget>) => budgets.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Budget> }) => budgets.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => budgets.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useGoals() {
  return useQuery({ queryKey: ['goals'], queryFn: goals.list });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Goal>) => goals.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Goal> }) => goals.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => goals.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

export function useBills() {
  return useQuery({ queryKey: ['bills'], queryFn: bills.list });
}

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Bill>) => bills.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Bill> }) => bills.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useDeleteBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bills.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useRecurringRules() {
  return useQuery({ queryKey: ['recurring_rules'], queryFn: recurringRules.list });
}

export function useCreateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<RecurringRule>) => recurringRules.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring_rules'] }),
  });
}

export function useUpdateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<RecurringRule> }) => recurringRules.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring_rules'] }),
  });
}

export function useDeleteRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recurringRules.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring_rules'] }),
  });
}

export function usePostRecurringRule() {
  const invalidate = useMoneyMutationInvalidation();
  const qc = useQueryClient();
  return useMutation({
    // `period` is the cycle the UI was showing as due - the server rejects it
    // if the rule already advanced past it, which is what stops a second
    // click from posting next month's payment too.
    mutationFn: ({ id, period }: { id: string; period?: string }) => recurringRules.post(id, period),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['recurring_rules'] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['recurring_rules'] }),
  });
}

// Fires once per app load to catch up any due auto_post recurring rules and
// settle credit-card autopay - see backend handleProcessDue (no cron on the
// VM, so "on every visit" stands in for one).
export function useProcessDue() {
  const invalidate = useMoneyMutationInvalidation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => processDue.run(),
    onSuccess: (data) => {
      if (data.posted_recurring.length > 0 || data.autopay_settled.length > 0) {
        invalidate();
        qc.invalidateQueries({ queryKey: ['recurring_rules'] });
      }
    },
  });
}

export function useReportsSummary(range: 'day' | 'week' | 'month' | 'year' | 'custom', start?: string, end?: string) {
  return useQuery({ queryKey: ['reports', range, start, end], queryFn: () => reports.summary(range, start, end) });
}
