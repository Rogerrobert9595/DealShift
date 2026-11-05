import { money } from "@/components/desk/fields";
import { cn } from "@/lib/utils";

export interface BarRow {
  label: string;
  parts: { k: string; v: number; c: string }[];
}

/**
 * Stacked monthly-outflow bars drawn to one dollar scale, so a cheaper deal is
 * physically shorter. Each bar is a dark pill flanked by glowing end-brackets.
 * When the last row is cheaper, the gap becomes a dashed "back in pocket" ghost block.
 */
export function CompareBars({ rows }: { rows: BarRow[] }) {
  const totals = rows.map((r) => Math.max(0, r.parts.reduce((s, p) => s + p.v, 0)));
  const max = Math.max(1, ...totals);
  return (
    <div className="space-y-5">
      {rows.map((r, i) => {
        const total = totals[i] ?? 0;
        const posTotal = r.parts.reduce((s, p) => s + Math.max(0, p.v), 0);
        const gap = max - total;
        const ghost = i === rows.length - 1 && i > 0 && gap >= 1;
        const ghostPct = (gap / max) * 100;
        const wide = ghostPct >= 24;
        return (
          <div key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-medium">{r.label}</span>
              <span className="num text-lg font-light tracking-tight">
                {money(total)}
                <span className="text-xs text-muted-foreground">/mo</span>
              </span>
            </div>
            <div className="flex h-9 w-full items-stretch">
              <div
                className="flex h-full items-center gap-1 rounded-lg border border-border bg-background/90 px-1 print:border-border"
                style={{ width: `${(total / max) * 100}%` }}
              >
                {r.parts.map((p) =>
                  p.v > 0 ? (
                    <div
                      key={p.k}
                      className="relative flex h-6 min-w-0 items-center overflow-hidden"
                      style={{ width: `${(p.v / (posTotal || 1)) * 100}%` }}
                      title={`${p.k} ${money(p.v)}`}
                    >
                      <i className={cn("absolute inset-y-0 left-0 w-[3px] rounded-full shadow-[0_0_8px_currentColor]", p.c)} />
                      <i className={cn("absolute inset-x-[3px] top-1/2 h-px -translate-y-1/2 opacity-40", p.c)} />
                      <i className={cn("absolute inset-y-0 right-0 w-[3px] rounded-full shadow-[0_0_8px_currentColor]", p.c)} />
                      <span className="num relative mx-auto truncate bg-background/90 px-1 text-[10px] text-muted-foreground">
                        {p.k} {money(p.v)}
                      </span>
                    </div>
                  ) : null,
                )}
              </div>
              {ghost && (
                <div
                  className="ml-1 flex h-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gain/70 bg-gain/10"
                  style={{ width: `calc(${ghostPct}% - 0.25rem)` }}
                  title={`${money(gap)}/mo back in pocket`}
                >
                  {wide && <span className="num truncate px-1.5 text-[11px] font-semibold text-gain">{money(gap)}/mo back in pocket</span>}
                </div>
              )}
            </div>
            {ghost && !wide && <div className="num mt-1 text-right text-xs font-semibold text-gain">↑ {money(gap)}/mo back in pocket</div>}
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {r.parts.map((p) => (
                <span key={p.k} className="flex items-center gap-1">
                  <i className={cn("h-2 w-2 rounded-full", p.c)} />
                  {p.k} <span className="num text-foreground">{money(p.v)}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Feels like" breakdown: payment minus running-cost savings plus insurance change. */
export function FeelsLikeBreakdown({
  payment,
  gasSave,
  maintSave,
  insDelta,
  feelsLike,
}: {
  payment: number;
  gasSave: number;
  maintSave: number;
  insDelta: number;
  feelsLike: number;
}) {
  const rows = [
    { k: "New loan payment", v: payment },
    { k: gasSave >= 0 ? "Gas you save" : "Extra gas", v: -gasSave },
    { k: maintSave >= 0 ? "Repairs you save" : "Extra repairs", v: -maintSave },
    { k: "Insurance change", v: insDelta },
  ];
  return (
    <div className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{r.k}</span>
          <span className={cn("num font-medium", r.v < 0 && "text-gain")}>
            {r.v < 0 ? "−" : "+"}
            {money(Math.abs(r.v))}
          </span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
        <span>Feels like</span>
        <span className="num text-primary print:text-foreground">{money(feelsLike)}/mo</span>
      </div>
    </div>
  );
}
