/**
 * Session state, backed by the shared ecosystem session.
 *
 * The surface is unchanged - every page still calls useAuth() for the current
 * user and the sign in / sign up / sign out verbs - but underneath it is now the
 * ecosystem's single sign-on rather than a token this app kept for itself.
 * Signing in authenticates against the identity service; the MoneyOS profile
 * (its default currency, which is MoneyOS's own, not identity's) is then read
 * from the MoneyOS function, which provisions the account on first touch.
 *
 * @module auth
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, type User } from '@/lib/api';
import { session } from '@/lib/session';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (email: string, username: string, password: string, displayName: string) => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** @public */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // MoneyOS's own profile carries the default currency, which identity does not,
  // so the signed-in person is read from the MoneyOS function once authenticated.
  const refreshUser = async () => {
    try {
      setUser(await auth.me());
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    // Restore a session from the shared cookie, if there is one. This is the SSO
    // path: arriving from another app, already signed in, lands here signed in.
    session.init()
      .then((state) => (state.status === 'authenticated' ? refreshUser() : setUser(null)))
      .finally(() => setLoading(false));

    // Keep the app's view in step if the session ends elsewhere (a sign-out in
    // another tab, a refresh that fails).
    const unsubscribe = session.subscribe((state) => {
      if (state.status === 'anonymous') setUser(null);
    });
    return unsubscribe;
  }, []);

  const signIn = async (identifier: string, password: string) => {
    await session.login(identifier, password);
    await refreshUser();
  };

  const signUp = async (email: string, username: string, password: string, displayName: string) => {
    await session.signup({ email, username, password, display_name: displayName });
    await refreshUser();
  };

  const signOut = () => {
    void session.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** @throws If used outside AuthProvider. @public */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
