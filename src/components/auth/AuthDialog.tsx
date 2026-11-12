import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

import { AuthForm, type AuthMode } from "./AuthForm";

/** Sign In / Sign Up modal over the desk, so the deal on screen isn't lost. Closes itself once signed in. */
export function AuthDialog({ open, onOpenChange, reason }: { open: boolean; onOpenChange: (o: boolean) => void; reason?: string | null }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");

  useEffect(() => {
    if (open && user) onOpenChange(false);
  }, [open, user, onOpenChange]);

  useEffect(() => {
    if (open) setMode("signin");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>
            {mode === "forgot" ? "Reset your password" : mode === "signup" ? "Create your account" : "Sign in to DealShift"}
          </DialogTitle>
          <DialogDescription>{reason ?? "Save customers and deals to your account and open them on any phone."}</DialogDescription>
        </DialogHeader>
        <AuthForm mode={mode} onModeChange={setMode} idPrefix="dlg" />
      </DialogContent>
    </Dialog>
  );
}
