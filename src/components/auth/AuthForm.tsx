import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import {
  getGoogleAuthConfig,
  requestPasswordReset,
  signInWithGoogleCredential,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth.functions";

export type AuthMode = "signin" | "signup" | "forgot";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            ux_mode?: "popup" | "redirect";
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z"
      />
    </svg>
  );
}

/** Email/password + Google sign in & sign up backed by Cloudflare D1. Used by the /auth page and the desk's sign-in modal. */
export function AuthForm({ mode, onModeChange, idPrefix = "auth" }: { mode: AuthMode; onModeChange: (m: AuthMode) => void; idPrefix?: string }) {
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [googleConfig, setGoogleConfig] = useState<{ clientId: string | null; oauthRedirectEnabled: boolean }>({
    clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null,
    oauthRedirectEnabled: false,
  });

  useEffect(() => {
    let active = true;
    getGoogleAuthConfig()
      .then((cfg) => {
        if (!active) return;
        setGoogleConfig((prev) => ({
          clientId: cfg.clientId ?? prev.clientId,
          oauthRedirectEnabled: cfg.oauthRedirectEnabled,
        }));
      })
      .catch(() => {
        /* ignore if offline */
      });
    return () => {
      active = false;
    };
  }, []);

  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    try {
      // If full OAuth redirect is configured (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET), use the server OAuth redirect flow
      if (googleConfig.oauthRedirectEnabled) {
        window.location.href = "/api/auth/google";
        return;
      }

      const clientId = googleConfig.clientId;
      if (!clientId) {
        window.location.href = "/api/auth/google";
        return;
      }

      // Client-only Google Identity Services ID token flow (requires only GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_ID)
      if (!window.google?.accounts?.id) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Could not load Google Sign-In.")), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = "https://accounts.google.com/gsi/client";
          script.async = true;
          script.defer = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Could not load Google Sign-In."));
          document.head.appendChild(script);
        });
      }

      window.google?.accounts?.id?.initialize({
        client_id: clientId,
        ux_mode: "popup",
        callback: async (response) => {
          if (!response.credential) {
            setGoogleBusy(false);
            return;
          }
          try {
            const res = await signInWithGoogleCredential({ data: { credential: response.credential } });
            if (res.error || !res.user || !res.token) {
              toast.error(res.error ?? "Google sign-in failed.");
              return;
            }
            setSession(res.user, res.token);
            toast.success("Signed in with Google");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Google sign-in failed.");
          } finally {
            setGoogleBusy(false);
          }
        },
      });
      window.google?.accounts?.id?.prompt();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setGoogleBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setResetLink(null);
    try {
      if (mode === "signin") {
        const res = await signInWithPassword({ data: { email: email.trim(), password } });
        if (res.error || !res.user || !res.token) throw new Error(res.error ?? "Invalid email or password.");
        setSession(res.user, res.token);
        toast.success("Signed in");
      } else if (mode === "signup") {
        const res = await signUpWithPassword({ data: { email: email.trim(), password } });
        if (res.error || !res.user || !res.token) throw new Error(res.error ?? "Could not create account.");
        setSession(res.user, res.token);
        toast.success("Account created");
      } else {
        const res = await requestPasswordReset({
          data: { email: email.trim(), origin: window.location.origin },
        });
        if (res.resetUrl) {
          setResetLink(res.resetUrl);
          setNotice("Password reset link generated below.");
        } else {
          setNotice("If that email has an account, a reset link is on its way.");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {mode !== "forgot" && (
        <>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setNotice(null);
              setResetLink(null);
              onModeChange(v as AuthMode);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            type="button"
            variant="outline"
            className="mt-4 h-11 w-full gap-2"
            disabled={busy || googleBusy}
            onClick={signInWithGoogle}
          >
            {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleGlyph />}
            {mode === "signup" ? "Sign up with Google" : "Continue with Google"}
          </Button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or with email</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={mode === "forgot" ? "mt-4 space-y-4" : "space-y-4"}>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 text-base"
          />
        </div>
        {mode !== "forgot" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${idPrefix}-password`}>Password</Label>
              {mode === "signin" && (
                <button type="button" className="text-xs text-primary" onClick={() => onModeChange("forgot")}>
                  Forgot password?
                </button>
              )}
            </div>
            <Input
              id={`${idPrefix}-password`}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 text-base"
            />
          </div>
        )}
        <Button type="submit" className="h-11 w-full" disabled={busy || googleBusy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </Button>
        {notice && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
            <p>{notice}</p>
            {resetLink && (
              <a href={resetLink} className="mt-2 inline-block break-all font-medium text-primary underline">
                Open password reset page
              </a>
            )}
          </div>
        )}
        {mode === "forgot" && (
          <button type="button" className="w-full text-sm text-muted-foreground" onClick={() => onModeChange("signin")}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
