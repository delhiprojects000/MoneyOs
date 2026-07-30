import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import logoMark from '@/assets/logo-mark.png';

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(username, password);
      } else {
        await signUp(email, username, password, displayName || username);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 p-2">
            <img src={logoMark} alt="" className="h-full w-full object-contain logo-mono" />
          </div>
          <h1 className="text-2xl font-semibold">MoneyOS</h1>
          <p className="text-sm text-muted-foreground">Your money, planned and tracked.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</CardTitle>
            <CardDescription>
              {mode === 'signin' ? 'Sign in to keep tracking your spending.' : 'Start tracking expenses, budgets, and goals.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              )}
              <div>
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
              </div>
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="display_name">Display name</Label>
                  <Input id="display_name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username || 'Your name'} />
                </div>
              )}
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
