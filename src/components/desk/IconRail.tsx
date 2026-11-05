import type { ReactNode } from "react";
import { ChevronRight, Clock, Eye, EyeOff, LayoutGrid, LogIn, Mail, Users, Warehouse } from "lucide-react";

import { cn } from "@/lib/utils";

export type RailItem = "desk" | "inventory" | "deals" | "equity" | "share";

interface Props {
  active: RailItem;
  presenting: boolean;
  email: string | null;
  dealCount: number | null;
  onSelect: (i: RailItem) => void;
  onTogglePresent: () => void;
  onAccount: () => void;
}

function RailBtn({ label, active, onClick, children, badge }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; badge?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
      {badge}
    </button>
  );
}

/** Fixed left navigation for lg+ screens. */
export function IconRail({ active, presenting, email, dealCount, onSelect, onTogglePresent, onAccount }: Props) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col items-center border-r border-border bg-sidebar py-4 lg:flex">
      <button type="button" className="group relative mb-6" onClick={() => onSelect("desk")} aria-label="Deal Desk home">
        <img src="/icons/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
        <ChevronRight className="absolute -right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
      <nav className="flex flex-1 flex-col items-center gap-2" aria-label="Sections">
        <RailBtn label="Deal Desk" active={active === "desk"} onClick={() => onSelect("desk")}>
          <LayoutGrid className="h-5 w-5" />
        </RailBtn>
        {!presenting && (
          <RailBtn label="Lot inventory" active={active === "inventory"} onClick={() => onSelect("inventory")}>
            <Warehouse className="h-5 w-5" />
          </RailBtn>
        )}
        {!presenting && (
          <RailBtn
            label="Saved customers"
            active={active === "deals"}
            onClick={() => onSelect("deals")}
            badge={
              dealCount ? (
                <span className="num absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {dealCount}
                </span>
              ) : null
            }
          >
            <Users className="h-5 w-5" />
          </RailBtn>
        )}
        <RailBtn label="Equity & milestones" active={active === "equity"} onClick={() => onSelect("equity")}>
          <Clock className="h-5 w-5" />
        </RailBtn>
        <RailBtn label="Share summary" onClick={() => onSelect("share")}>
          <Mail className="h-5 w-5" />
        </RailBtn>
      </nav>
      <div className="flex flex-col items-center gap-3">
        <RailBtn label={presenting ? "Customer View on (Alt+C)" : "Switch to Customer View (Alt+C)"} active={presenting} onClick={onTogglePresent}>
          {presenting ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </RailBtn>
        {!presenting && (
          <button
            type="button"
            onClick={onAccount}
            title={email ?? "Sign in"}
            aria-label={email ? `Signed in as ${email}` : "Sign in"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-gradient-to-br from-sage/40 to-coral/40 text-sm font-semibold uppercase"
          >
            {email ? email[0] : <LogIn className="h-4 w-4" />}
          </button>
        )}
      </div>
    </aside>
  );
}
