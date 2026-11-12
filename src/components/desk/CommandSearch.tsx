import { useMemo, useRef, useState, type ReactNode } from "react";
import { Car, Search, Users } from "lucide-react";

import { money } from "@/components/desk/fields";
import type { Vehicle } from "@/lib/inventory";
import type { SavedDeal } from "@/lib/saved-deals";
import { cn } from "@/lib/utils";

type FilterId = "awd" | "fwd" | "u25" | "25to35" | "aged";
const FILTERS: { id: FilterId; label: string; group: string; test: (v: Vehicle) => boolean }[] = [
  { id: "awd", label: "AWD / 4WD", group: "Drivetrain", test: (v) => /\b(awd|4wd|4x4|all.?wheel)\b/i.test(`${v.makeModel} ${v.desc}`) },
  { id: "fwd", label: "FWD", group: "Drivetrain", test: (v) => /\b(fwd|2wd|front.?wheel)\b/i.test(`${v.makeModel} ${v.desc}`) },
  { id: "u25", label: "Under $25k", group: "Price", test: (v) => v.price > 0 && v.price < 25000 },
  { id: "25to35", label: "$25k–$35k", group: "Price", test: (v) => v.price >= 25000 && v.price <= 35000 },
  { id: "aged", label: "Aged > 45d", group: "Lot age", test: (v) => v.days > 45 },
];

function Hl({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-primary/25 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

interface Props {
  inventory: Vehicle[];
  deals: SavedDeal[];
  hideInternal: boolean;
  onPickVehicle: (v: Vehicle) => void;
  onPickDeal: (d: SavedDeal) => void;
}

/** Universal search: inventory + saved customers, with quick filters, in one floating panel. */
export function CommandSearch({ inventory, deals, hideInternal, onPickVehicle, onPickDeal }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Set<FilterId>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);
  const term = q.trim();

  const vehicles = useMemo(() => {
    const active = FILTERS.filter((f) => filters.has(f.id));
    const groups = Array.from(new Set(active.map((f) => f.group)));
    const t = term.toLowerCase();
    const out: Vehicle[] = [];
    for (const v of inventory) {
      if (groups.length && !groups.every((g) => active.some((f) => f.group === g && f.test(v)))) continue;
      if (t && !`${v.stock} ${v.year} ${v.makeModel} ${v.desc} ${v.vin}`.toLowerCase().includes(t)) continue;
      out.push(v);
      if (out.length === 8) break;
    }
    return out;
  }, [inventory, filters, term]);

  const customers = useMemo(() => {
    const t = term.toLowerCase();
    if (!t) return deals.slice(0, 3);
    const out: SavedDeal[] = [];
    for (const d of deals) {
      if (`${d.customerName} ${d.customerPhone ?? ""} ${d.proposedStock ?? ""}`.toLowerCase().includes(t)) {
        out.push(d);
        if (out.length === 4) break;
      }
    }
    return out;
  }, [deals, term]);

  const close = () => {
    setOpen(false);
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const toggle = (id: FilterId) =>
    setFilters((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div
      ref={wrap}
      className="relative flex-1"
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = vehicles[0];
          if (v) {
            onPickVehicle(v);
            close();
          }
        }}
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && close()}
          placeholder="Search stock #, model, VIN, or saved customer…"
          enterKeyHint="go"
          aria-label="Search inventory and customers"
          className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-base outline-none placeholder:text-muted-foreground focus:border-ring/60 sm:text-sm"
        />
      </form>

      {open && (
        <div className="glass absolute left-0 right-0 top-full z-50 mt-2 grid max-h-[70dvh] overflow-y-auto rounded-2xl p-3 md:grid-cols-[1fr_200px] md:gap-3">
          <div className="min-w-0">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Inventory matches</div>
            <ul>
              {vehicles.map((v) => (
                <li key={v.stock}>
                  <button
                    type="button"
                    onClick={() => {
                      onPickVehicle(v);
                      close();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <span className="num shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-primary">
                      #<Hl text={v.stock} q={term} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <Hl text={`${v.year} ${v.makeModel} ${v.desc}`} q={term} />
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">{v.epaMpg ? `${v.epaMpg} mpg` : ""}</span>
                    <span className="num w-16 shrink-0 text-right text-sm font-medium">{money(v.price)}</span>
                  </button>
                </li>
              ))}
              {!vehicles.length && <li className="px-2 py-3 text-sm text-muted-foreground">No units match.</li>}
            </ul>
            {!hideInternal && customers.length > 0 && (
              <>
                <div className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saved customers</div>
                <ul>
                  {customers.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPickDeal(d);
                          close();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
                      >
                        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <Hl text={d.customerName} q={term} />
                        </span>
                        <span className="flex shrink-0 items-center gap-1 truncate text-xs text-muted-foreground">
                          <Car className="h-3 w-3" />
                          {d.vehicle ? `#${d.vehicle.stock}` : d.proposedStock ? `#${d.proposedStock}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="mt-3 border-t border-border pt-3 md:mt-0 md:border-l md:border-t-0 md:pl-3 md:pt-0">
            <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Quick filters</div>
            <div className="flex flex-wrap gap-1.5 md:flex-col">
              {FILTERS.filter((f) => !(hideInternal && f.id === "aged")).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filters.has(f.id)}
                  onClick={() => toggle(f.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors md:rounded-lg",
                    filters.has(f.id) ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span className={cn("h-3 w-3 rounded-[4px] border", filters.has(f.id) ? "border-primary bg-primary" : "border-muted-foreground/50")} />
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
