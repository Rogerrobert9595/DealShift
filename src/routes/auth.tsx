import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { AuthForm, type AuthMode } from "@/components/auth/AuthForm";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in – DealShift" },
      { name: "description", content: "Sign in to DealShift to save your customers and deal structures and pick them up on any device." },
      { property: "og:title", content: "Sign in – DealShift" },
      { property: "og:description", content: "Save customers and deals to your salesperson account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");

  useEffect(() => {
    if (ready && user) void navigate({ to: "/", replace: true });
  }, [ready, user, navigate]);

  return (
    <div className="flex min-h-dvh flex-col px-5 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <Link to="/" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to the desk
      </Link>
      <div className="mx-auto mt-10 w-full max-w-sm">
        <img src="/icons/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 rounded-2xl" />
        <h1 className="mt-4 text-2xl font-semibold">
          {mode === "forgot" ? "Reset your password" : mode === "signup" ? "Create your account" : "Sign in to DealShift"}
        </h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">Save customers and deals to your account and open them on any device.</p>
        <AuthForm mode={mode} onModeChange={setMode} />
      </div>
    </div>
  );
}
