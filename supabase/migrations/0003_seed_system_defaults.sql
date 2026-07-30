-- System-wide default categories and payment methods (user_id null) - every
-- user sees these automatically (queries filter `user_id = me or user_id is
-- null`), on top of whatever custom ones they add themselves.

insert into moneyos.categories (name, kind, icon, color, is_system, sort_order) values
  ('Food & Dining', 'expense', 'utensils', '#f97316', true, 10),
  ('Groceries', 'expense', 'shopping-cart', '#84cc16', true, 20),
  ('Transport', 'expense', 'car', '#0ea5e9', true, 30),
  ('Rent', 'expense', 'home', '#8b5cf6', true, 40),
  ('Utilities', 'expense', 'zap', '#eab308', true, 50),
  ('Subscriptions', 'expense', 'repeat', '#ec4899', true, 60),
  ('Entertainment', 'expense', 'clapperboard', '#d946ef', true, 70),
  ('Shopping', 'expense', 'shopping-bag', '#f43f5e', true, 80),
  ('Health & Medical', 'expense', 'heart-pulse', '#ef4444', true, 90),
  ('Education', 'expense', 'graduation-cap', '#3b82f6', true, 100),
  ('Travel', 'expense', 'plane', '#14b8a6', true, 110),
  ('EMI & Loans', 'expense', 'landmark', '#64748b', true, 120),
  ('Group Expenses', 'expense', 'users', '#f59e0b', true, 130),
  ('Investments', 'expense', 'trending-up', '#22c55e', true, 140),
  ('Other Expense', 'expense', 'more-horizontal', '#94a3b8', true, 990),
  ('Salary', 'income', 'wallet', '#16a34a', true, 10),
  ('Freelance', 'income', 'briefcase', '#0d9488', true, 20),
  ('Business', 'income', 'store', '#0891b2', true, 30),
  ('Investment Income', 'income', 'trending-up', '#22c55e', true, 40),
  ('Gifts', 'income', 'gift', '#db2777', true, 50),
  ('Refunds', 'income', 'undo-2', '#65a30d', true, 60),
  ('Other Income', 'income', 'more-horizontal', '#94a3b8', true, 990);

insert into moneyos.payment_methods (name, category, icon, is_system, sort_order) values
  ('Cash', 'cash', 'banknote', true, 10),
  ('UPI - Google Pay', 'upi', 'smartphone', true, 20),
  ('UPI - PhonePe', 'upi', 'smartphone', true, 30),
  ('UPI - Paytm', 'upi', 'smartphone', true, 40),
  ('UPI - CRED', 'upi', 'smartphone', true, 50),
  ('UPI - FamPay', 'upi', 'smartphone', true, 60),
  ('UPI - Amazon Pay', 'upi', 'smartphone', true, 70),
  ('UPI - BHIM', 'upi', 'smartphone', true, 80),
  ('UPI - WhatsApp Pay', 'upi', 'smartphone', true, 90),
  ('UPI - Other', 'upi', 'smartphone', true, 100),
  ('Debit Card', 'card', 'credit-card', true, 110),
  ('Credit Card', 'card', 'credit-card', true, 120),
  ('Net Banking', 'bank', 'landmark', true, 130),
  ('Bank Transfer (NEFT/IMPS/RTGS)', 'bank', 'landmark', true, 140),
  ('Cheque', 'bank', 'file-text', true, 150),
  ('Other', 'other', 'more-horizontal', true, 990);
