import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { BadgePercent, Printer } from "lucide-react";

import { CompareBars, FeelsLikeBreakdown } from "@/components/desk/CompareBars";
import { EquityChart } from "@/components/desk/EquityChart";
import { chartMilestones, MilestoneChips } from "@/components/desk/milestones";
import { money } from "@/components/desk/fields";
import { Button } from "@/components/ui/button";
import { simulate } from "@/lib/deal-math";
import { decodeSummary } from "@/lib/summary-link";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/summary")({
  validateSearch: (s: Record<string, unknown>) => ({ d: typeof s["d"] === "string" ? s["d"] : "" }),
  head: () => ({
    meta: [
      { title: "Your Deal Summary – DealShift" },
      { name: "description", content: "A read-only summary of your monthly costs, payment and equity timeline for the vehicle you looked at." },
      { property: "og:title", content: "Your Deal Summary" },
      { property: "og:description", content: "Your monthly outflow, what the payment really feels like, and when you build equity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SummaryPage,
});

function SummaryPage() {
  const { d } = Route.useSearch();
  const data = useMemo(() => decodeSummary(d), [d]);
  const sim = useMemo(() => (data ? simulate(data.deal, data.current, data.startMiles) : null), [data]);

  if (!data || !sim) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">This summary link is incomplete</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask your salesperson to send it again.</p>
          <Link to="/" className="mt-6 inline-block text-sm text-primary underline">
            Open DealShift
          </Link>
        </div>
      </div>
    );
  }

  const { deal, current, title } = data;
  const mark = sim.breakevenMonth && sim.breakevenMonth > 0 ? sim.breakevenMonth : Math.min(36, deal.term);
  const saves = sim.trueDelta >= 0;
  const milestones = data.modelYear
    ? chartMilestones(data.modelYear, data.startMiles, sim.annualMiles, sim.breakevenMonth, deal.term)
    : { warranty: null, window: null };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-12 pt-[calc(1.25rem+env(safe-area-inset-top))] print:max-w-none print:space-y-3 print:p-0">
      <header className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl print:hidden" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary print:text-foreground">Your deal summary</div>
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        </div>
        <Button variant="secondary" size="sm" className="h-10 print:hidden" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Save PDF
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Big label="Payment" value={`${money(sim.payment)}/mo`} sub={`${deal.term} mo · ${deal.apr}% APR`} />
        <Big label="Feels like" value={`${money(sim.feelsLike)}/mo`} sub="after gas & repair savings" accent />
        <Big
          label="Monthly cash flow"
          value={`${saves ? "Saves" : "Adds"} ${money(Math.abs(sim.trueDelta))}`}
          sub="vs. your current car"
          tone={saves ? "gain" : "cost"}
        />
      </div>

      {sim.tradeTaxSavings > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm print:border-border print:bg-transparent">
          <BadgePercent className="h-4 w-4 shrink-0 text-primary print:text-foreground" />
          <span>
            <strong>Hidden savings:</strong> your trade-in lowers the taxable price, saving{" "}
            <strong className="num">{money(sim.tradeTaxSavings)}</strong> in sales tax.
          </span>
        </div>
      )}

      <Card title="Total monthly outflow">
        <CompareBars
          rows={[
            {
              label: "Your current car",
              parts: [
                { k: "Payment", v: current.currPay, c: "bg-pay" },
                { k: "Gas", v: sim.currGas, c: "bg-fuel" },
                { k: "Repairs", v: current.currMaint, c: "bg-maint" },
              ],
            },
            {
              label: "This vehicle",
              parts: [
                { k: "Payment", v: sim.payment, c: "bg-pay" },
                { k: "Gas", v: sim.propGas, c: "bg-fuel" },
                { k: "Repairs", v: deal.maint, c: "bg-maint" },
                { k: current.insDelta < 0 ? "Insurance" : "Insurance +", v: current.insDelta, c: "bg-ins" },
              ],
            },
          ]}
        />
      </Card>

      <Card title="What the payment really feels like">
        <FeelsLikeBreakdown payment={sim.payment} gasSave={sim.gasSave} maintSave={sim.maintSave} insDelta={current.insDelta} feelsLike={sim.feelsLike} />
      </Card>

      <Card
        title="When you build equity"
        sub={
          sim.breakevenMonth === 0
            ? "Positive equity from day one."
            : sim.breakevenMonth
              ? `Your estimated trade value passes your loan payoff at month ${sim.breakevenMonth}.`
              : "Your loan payoff stays above the estimated trade value through this term."
        }
      >
        <div className="mb-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-full bg-gain" /> Est. trade value</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-full bg-cost" /> Loan payoff</span>
        </div>
        <div className="print:mx-auto print:w-3/4">
          <EquityChart series={sim.series} month={mark} breakeven={sim.breakevenMonth} milestones={milestones} />
        </div>
        <MilestoneChips m={milestones} />
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Based on {Math.round(sim.annualMiles).toLocaleString("en-US")} miles a year and gas at ${current.gasPrice.toFixed(2)}/gal. Fuel uses EPA
        ratings; trade value is an estimate. All figures are estimates for discussion and subject to credit approval and final paperwork.
      </p>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Big({ label, value, sub, tone, accent }: { label: string; value: string; sub: string; tone?: "gain" | "cost"; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3", accent ? "border-primary/40 bg-primary/10 print:bg-transparent" : "border-border bg-card")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num mt-1 text-lg font-bold leading-tight sm:text-xl", tone === "gain" && "text-gain", tone === "cost" && "text-cost")}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
