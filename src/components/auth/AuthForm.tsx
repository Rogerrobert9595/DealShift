import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { requestPasswordReset, signInWithPassword, signUpWithPassword } from "@/lib/auth.functions";

export type AuthMode = "signin" | "signup" | "forgot";

/** Email/password sign in + sign up backed by Cloudflare D1. Used by the /auth page and the desk's sign-in modal. */
export function AuthForm({ mode, onModeChange, idPrefix = "auth" }: { mode: AuthMode; onModeChange: (m: AuthMode) => void; idPrefix?: string }) {
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);

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
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
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
        <Button type="submit" className="h-11 w-full" disabled={busy}>
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
