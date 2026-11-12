import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAuthSession, signOutSession, type AuthUser } from "@/lib/auth.functions";
import { clearStoredSessionToken, getStoredSessionToken, saveStoredSessionToken } from "@/lib/auth-storage";

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  setSession: (user: AuthUser, token: string) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  ready: false,
  setSession: () => {},
  signOut: async () => {},
});

/** Single session listener for the whole app; the desk works signed-out, signing in unlocks saved deals on Cloudflare D1. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const token = getStoredSessionToken();
    getAuthSession({ data: { token } })
      .then((res) => {
        if (cancelled) return;
        if (!res.user && token) clearStoredSessionToken();
        setUser(res.user);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSession = useCallback((nextUser: AuthUser, token: string) => {
    saveStoredSessionToken(token);
    setUser(nextUser);
    setReady(true);
  }, []);

  const signOut = useCallback(async () => {
    const token = getStoredSessionToken();
    clearStoredSessionToken();
    setUser(null);
    await queryClient.cancelQueries();
    queryClient.removeQueries({ queryKey: ["saved_deals"] });
    try {
      await signOutSession({ data: { token } });
    } catch {
      /* ignore network errors on sign-out */
    }
  }, [queryClient]);

  return <AuthContext.Provider value={{ user, ready, setSession, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
