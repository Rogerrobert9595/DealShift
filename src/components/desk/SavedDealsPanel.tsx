import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Car, FilePlus2, Loader2, LogIn, LogOut, Phone, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useSavedDeals } from "@/hooks/use-saved-deals";
import { monthlyCashFlowDelta } from "@/lib/deal-math";
import { deleteDeal, type SavedDeal } from "@/lib/saved-deals";
import { cn } from "@/lib/utils";

import { money } from "./fields";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeDeal: SavedDeal | null;
  onLoad: (deal: SavedDeal) => void;
  onDeleted: (id: string) => void;
  /** Clears the open customer so the next save creates a new one. */
  onNewCustomer: () => void;
  onSignIn: () => void;
}

/** Monthly cash-flow difference for a saved deal (positive = customer keeps more). */
function cashFlow(d: SavedDeal): number | null {
  if (!d.deal || !d.current) return null;
  return monthlyCashFlowDelta(d.deal, d.current);
}

/** "My Customers" slide-out: every saved customer, tap to load onto the desk. */
export function SavedDealsPanel({ open, onOpenChange, activeDeal, onLoad, onDeleted, onNewCustomer, onSignIn }: Props) {
  const isMobile = useIsMobile();
  const { user, ready, signOut } = useAuth();
  const qc = useQueryClient();
  const deals = useSavedDeals();
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(null), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const remove = useMutation({
    mutationFn: deleteDeal,
    onSuccess: (_r, id) => {
      void qc.invalidateQueries({ queryKey: ["saved_deals"] });
      onDeleted(id);
      toast("Deal deleted");
    },
    onError: () => toast.error("Couldn't delete the deal."),
  });

  const filtered = useMemo(() => {
    const list = deals.data ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) =>
      [d.customerName, d.customerPhone, d.proposedStock, d.vehicle?.makeModel, d.tradeCar?.label, d.notes].join(" ").toLowerCase().includes(q),
    );
  }, [deals.data, filter]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-0 p-0", isMobile ? "h-[88dvh] rounded-t-3xl" : "w-full sm:max-w-md")}
      >
        <SheetHeader className="border-b border-border px-5 pb-3 pt-5 text-left">
          <SheetTitle>
            My Customers{deals.data ? <span className="num ml-1.5 text-muted-foreground">({deals.data.length})</span> : null}
          </SheetTitle>
          <SheetDescription className="flex items-center justify-between gap-2">
            <span className="truncate">{user ? user.email : "Your saved customers and deal structures"}</span>
            {user && (
              <button type="button" onClick={() => void signOut()} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            )}
          </SheetDescription>
        </SheetHeader>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !user ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <Users className="h-10 w-10 text-primary" />
            <p className="text-sm text-muted-foreground">Sign in to save customers and deal structures and open them again on any phone.</p>
            <Button className="h-11 w-full max-w-xs" onClick={onSignIn}>
              <LogIn className="h-4 w-4" /> Sign in / Sign up
            </Button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name, phone, stock #" className="h-11 pl-9 text-base" />
              </div>
              {activeDeal && (
                <Button
                  variant="secondary"
                  className="h-11"
                  onClick={() => {
                    onNewCustomer();
                    onOpenChange(false);
                  }}
                >
                  <FilePlus2 className="h-4 w-4" /> New
                </Button>
              )}
            </div>

            <ul className="mt-3 space-y-2">
              {deals.isLoading && (
                <li className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </li>
              )}
              {deals.isError && <li className="py-6 text-center text-sm text-muted-foreground">Couldn't load your customers.</li>}
              {filtered.map((d) => {
                const flow = cashFlow(d);
                return (
                  <li
                    key={d.id}
                    className={cn("flex items-stretch gap-2 rounded-xl border p-1", d.id === activeDeal?.id ? "border-primary bg-primary/10" : "border-border bg-background/40")}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-lg p-2 text-left active:bg-accent"
                      onClick={() => {
                        onLoad(d);
                        onOpenChange(false);
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{d.customerName}</span>
                        {flow != null && (
                          <span className={cn("num shrink-0 text-xs font-semibold", flow >= 0 ? "text-gain" : "text-cost")}>
                            {flow >= 0 ? "Saves" : "Adds"} {money(Math.abs(flow))}/mo
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Car className="h-3 w-3 shrink-0" />
                        <span className="truncate">Trade: {d.tradeCar?.label || "not entered"}</span>
                      </div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {d.vehicle ? `#${d.vehicle.stock} · ${d.vehicle.year} ${d.vehicle.makeModel}` : d.proposedStock ? `#${d.proposedStock}` : "No unit"}
                        </span>
                      </div>
                      <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        <span>{new Date(d.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        {d.deal && (
                          <span>
                            {money(d.deal.price)} · {d.deal.term} mo · {d.deal.apr}%
                          </span>
                        )}
                        {d.customerPhone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {d.customerPhone}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={confirmDelete === d.id ? `Confirm delete ${d.customerName}` : `Delete ${d.customerName}`}
                      className={cn(
                        "flex w-12 shrink-0 flex-col items-center justify-center rounded-lg text-[10px]",
                        confirmDelete === d.id ? "bg-destructive/20 text-destructive" : "text-muted-foreground active:bg-accent",
                      )}
                      onClick={() => (confirmDelete === d.id ? remove.mutate(d.id) : setConfirmDelete(d.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                      {confirmDelete === d.id && "Sure?"}
                    </button>
                  </li>
                );
              })}
              {deals.isSuccess && !filtered.length && (
                <li className="py-8 text-center text-sm text-muted-foreground">
                  {filter ? "No matches." : "No saved customers yet. Use Save Customer at the top."}
                </li>
              )}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
