import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgePercent,
  CalendarClock,
  Copy,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  Send,
  Fuel,
  Gauge,
  LineChart,
  Loader2,
  MapPin,
  Share2,
  Car,
  Warehouse,
  Wrench,
  Wallet,
  Users,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { CompareBars } from "@/components/desk/CompareBars";
import { CommandSearch } from "@/components/desk/CommandSearch";
import { IconRail, type RailItem } from "@/components/desk/IconRail";
import { CurrentCarLookup } from "@/components/desk/CurrentCarLookup";
import { EquityChart } from "@/components/desk/EquityChart";
import { Field, money, num, NumInput, Panel, signedMoney, SliderField } from "@/components/desk/fields";
import { InventoryPanel } from "@/components/desk/InventoryPanel";
import { SavedDealsPanel } from "@/components/desk/SavedDealsPanel";
import { SaveCustomerPopover } from "@/components/desk/SaveCustomerPopover";
import { SpecBadge } from "@/components/desk/SpecBadge";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/use-auth";
import { useInventory } from "@/hooks/use-inventory";
import { useSavedDeals } from "@/hooks/use-saved-deals";
import { type SavedDeal, type TradeCar } from "@/lib/saved-deals";
import { chartMilestones, MilestoneChips } from "@/components/desk/milestones";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  annualDepreciationRate,
  BASELINE_MILES,
  calculateBookValue,
  estimateInsuranceDelta,
  estimateMaint,
  evaluateLtv,
  fallbackMsrp,
  lookupZipRates,
  makeFromModel,
  monthlyCashFlowDelta,
  odometerAt,
  quickDeal,
  SERVICE_PILLS,
  simulate,
  type CurrentInputs,
  type DealInputs,
  type LtvAssessment,
  type SimPoint,
} from "@/lib/deal-math";
import { isVin, SAMPLE_INVENTORY, type Vehicle } from "@/lib/inventory";
import { vehicleLookupCache } from "@/lib/lookup-cache";
import { encodeSummary } from "@/lib/summary-link";
import { cn } from "@/lib/utils";
import { lookupLocalRates, lookupVehicleSpecs } from "@/lib/vehicle.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DealShift – Ownership & Equity Twin" },
      {
        name: "description",
        content:
          "Phone-ready dealership desk: compare a customer's current car with any stock unit — payment, fuel, maintenance and equity crossover.",
      },
      { property: "og:title", content: "DealShift – Ownership & Equity Twin" },
      {
        property: "og:description",
        content: "Show customers their real monthly cash flow and when they'll have positive trade equity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeskPage,
});

type Tab = "deal" | "costs" | "equity";
type Overlay = "inventory" | "deals" | "save" | null;
const TERMS = [48, 60, 72, 84];

const DEFAULT_DEAL: DealInputs = {
  price: 23999,
  cash: 2500,
  tradeValue: 0,
  tradePayoff: 0,
  taxRate: 8,
  tradeTaxCredit: true,
  fees: 375,
  apr: 6.9,
  term: 72,
  mpg: 27,
  maint: 58,
};
const DEFAULT_CURRENT: CurrentInputs = {
  commute: 42,
  currPay: 0,
  currMpg: 0,
  currMaint: 0,
  gasPrice: 3.45,
  insDelta: 0,
};

/** Proposed-unit EPA / VIN lookup state. `mpg` is the looked-up MPG (badge shows while the field still matches it). */
interface SpecState {
  status: "idle" | "loading" | "epa" | "estimate" | "none";
  mpg: number | null;
  engineFrom: "sheet" | "lookup" | null;
}
const IDLE_SPEC: SpecState = { status: "idle", mpg: null, engineFrom: null };

/** Sign-in dialog: why it opened, and whether to reopen Save Customer afterwards. */
interface AuthPrompt {
  open: boolean;
  reason: string | null;
  thenSave: boolean;
}

type SpecsFn = ReturnType<typeof useServerFn<typeof lookupVehicleSpecs>>;

/** EPA/VIN specs for a stock unit, cached for the session so revisiting a unit is instant. */
function unitSpecs(fetchSpecs: SpecsFn, v: Vehicle) {
  // VIN when the sheet has one, else year + make + model from the unit's name.
  const [mk, ...rest] = v.makeModel.split(/\s+/);
  const miles = Math.max(0, Number.isFinite(v.miles) ? v.miles : 0);
  const year = Number.isInteger(v.year) && v.year >= 0 && v.year <= 2100 ? v.year : null;
  const data = isVin(v.vin)
    ? { vin: v.vin.trim(), miles }
    : { year, make: mk ?? null, model: rest.join(" ") || null, miles };
  return vehicleLookupCache.get(`specs:${JSON.stringify(data)}`, () => fetchSpecs({ data }), (s) => s.source !== "none");
}

function DeskPage() {
  const [selected, setSelected] = useState<Vehicle>(SAMPLE_INVENTORY[0]!);
  const [deal, setDeal] = useState<DealInputs>(DEFAULT_DEAL);
  const [current, setCurrent] = useState<CurrentInputs>(DEFAULT_CURRENT);
  const [scrub, setScrub] = useState(36);
  const [tab, setTab] = useState<Tab>("deal");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [activeDeal, setActiveDeal] = useState<SavedDeal | null>(null);
  const [tradeCar, setTradeCar] = useState<TradeCar | null>(null);
  const [lookupKey, setLookupKey] = useState(0);
  const [auth, setAuth] = useState<AuthPrompt>({ open: false, reason: null, thenSave: false });
  const [spec, setSpec] = useState<SpecState>(IDLE_SPEC);
  const [presenting, setPresenting] = useState(false);
  const [pinned, setPinned] = useState<{ term: number; cash: number; payment: number; breakeven: number | null; series: SimPoint[] } | null>(null);
  const [rail, setRail] = useState<RailItem>("desk");
  const [zip, setZip] = useState("");
  const [zipInfo, setZipInfo] = useState<{ region: string; source: "live" | "regional"; loading?: boolean } | null>(null);
  const { user } = useAuth();
  const savedDeals = useSavedDeals();
  const vinReq = useRef(0);
  const zipReq = useRef(0);
  const skipAutoInsRef = useRef(false);
  const specs = useServerFn(lookupVehicleSpecs);
  const fetchLocalRates = useServerFn(lookupLocalRates);

  const setD = <K extends keyof DealInputs>(k: K) => (v: DealInputs[K]) => setDeal((d) => ({ ...d, [k]: v }));
  const setC = <K extends keyof CurrentInputs>(k: K) => (v: CurrentInputs[K]) => setCurrent((c) => ({ ...c, [k]: v }));
  /** open/onOpenChange pair for one overlay; closing only clears it if it's still the open one. */
  const overlayProps = (k: Exclude<Overlay, null>) => ({
    open: overlay === k,
    onOpenChange: (o: boolean) => setOverlay((cur) => (o ? k : cur === k ? null : cur)),
  });

  const lookupSpecs = async (v: Vehicle, preserveDeal = false) => {
    const id = ++vinReq.current;
    setSpec({ status: "loading", mpg: null, engineFrom: v.engine ? "sheet" : null });
    try {
      const s = await unitSpecs(specs, v);
      if (id !== vinReq.current) return;
      if (s.source === "none") {
        setSpec((p) => ({ ...p, status: "none" }));
        return;
      }
      const useLookup = s.source === "epa" || v.epaMpg == null;
      setSpec({
        status: s.source,
        mpg: useLookup && s.combMpg ? s.combMpg : null,
        engineFrom: v.engine ? "sheet" : s.engine ? "lookup" : null,
      });
      // The sheet's engine spec wins; the VIN decode fills it in when the sheet has none.
      setSelected((cur) =>
        cur.stock === v.stock ? { ...cur, cityMpg: s.cityMpg, hwyMpg: s.hwyMpg, engine: v.engine || s.engine || null } : cur,
      );
      if (!preserveDeal) {
        setDeal((d) => ({
          ...d,
          mpg: useLookup ? (s.combMpg ?? d.mpg) : d.mpg,
          maint: v.estMaint == null && s.estMaint ? s.estMaint : d.maint,
        }));
      }
    } catch {
      if (id === vinReq.current) setSpec((p) => ({ ...p, status: "none" }));
    }
  };

  const applyVehicle = (v: Vehicle, lookupVin = true) => {
    setSelected(v);
    setPinned(null);
    setDeal((d) => ({
      ...d,
      price: v.price,
      mpg: v.epaMpg ?? d.mpg,
      maint: v.estMaint ?? estimateMaint(makeFromModel(v.makeModel), v.miles),
    }));
    setSpec({ ...IDLE_SPEC, engineFrom: v.engine ? "sheet" : null });
    if (lookupVin) void lookupSpecs(v);
  };

  const { inventory, source, sheet, replace } = useInventory({
    userId: user?.id,
    onPick: applyVehicle,
    getSelection: () => ({ stock: selected.stock, locked: !!activeDeal }),
  });

  // Alt + C flips between Desk View and Customer View.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyC") {
        e.preventDefault();
        setPresenting((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Customer view hides everything internal, including the save/customer controls.
  useEffect(() => {
    if (presenting) setOverlay(null);
  }, [presenting]);

  // Tapped Save Customer while signed out → reopen the save form once signed in.
  useEffect(() => {
    if (user && auth.thenSave) {
      setAuth((a) => ({ ...a, thenSave: false }));
      setOverlay("save");
    }
  }, [user, auth.thenSave]);

  // Automatically estimate insurance delta when both a proposed unit and a trade-in vehicle are selected.
  useEffect(() => {
    if (skipAutoInsRef.current) {
      skipAutoInsRef.current = false;
      return;
    }
    if (!tradeCar) return;
    const tradeMSRP = fallbackMsrp(`${tradeCar.make ?? ""} ${tradeCar.model ?? ""} ${tradeCar.label ?? ""}`);
    const insDelta = estimateInsuranceDelta({
      tradeYear: tradeCar.year,
      tradeMSRP,
      proposedMSRP: selected.price,
      proposedYear: selected.year,
      hasAdvancedSafety: selected.year >= 2020,
    });
    setCurrent((c) => (c.insDelta === insDelta ? c : { ...c, insDelta }));
  }, [selected.stock, selected.price, selected.year, tradeCar]);

  const applyZip = async (rawZip: string, silent = false) => {
    const clean = rawZip.replace(/\D/g, "").slice(0, 5);
    if (clean.length !== 5) return;
    const local = lookupZipRates(clean);
    if (!local) {
      if (!silent) toast.error("Enter a valid 5-digit US ZIP code");
      return;
    }
    const id = ++zipReq.current;
    setDeal((d) => ({ ...d, taxRate: local.taxRate, tradeTaxCredit: local.tradeTaxCredit }));
    setCurrent((c) => ({ ...c, gasPrice: local.gasPrice }));
    setZipInfo({ region: local.region, source: "regional", loading: true });
    try {
      localStorage.setItem("deal_desk_zip", clean);
    } catch {
      /* ignore storage errors */
    }
    try {
      const live = await vehicleLookupCache.get(`zip:${clean}`, () => fetchLocalRates({ data: { zip: clean } }), Boolean);
      if (id !== zipReq.current || !live) {
        if (id === zipReq.current) setZipInfo((prev) => (prev ? { ...prev, loading: false } : null));
        return;
      }
      setDeal((d) => ({ ...d, taxRate: live.taxRate, tradeTaxCredit: live.tradeTaxCredit }));
      setCurrent((c) => ({ ...c, gasPrice: live.gasPrice }));
      setZipInfo({ region: live.region, source: live.source, loading: false });
    } catch {
      if (id === zipReq.current) setZipInfo((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  const handleZipChange = (val: string) => {
    const clean = val.replace(/\D/g, "").slice(0, 5);
    setZip(clean);
    if (clean.length === 5) {
      void applyZip(clean);
    } else {
      zipReq.current++;
      setZipInfo(null);
    }
  };

  // Restore saved dealership/customer ZIP on mount so local sales tax and gas price are pre-filled.
  useEffect(() => {
    try {
      const savedZip = localStorage.getItem("deal_desk_zip")?.trim() ?? "";
      if (/^\d{5}$/.test(savedZip)) {
        setZip(savedZip);
        void applyZip(savedZip, true);
      }
    } catch {
      /* ignore storage errors */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askSignIn = (reason: string | null, thenSave = false) => setAuth({ open: true, reason, thenSave });

  const loadSavedDeal = (d: SavedDeal) => {
    skipAutoInsRef.current = !!d.current;
    const live = d.proposedStock ? inventory.find((v) => v.stock === d.proposedStock) : undefined;
    const v: Vehicle | undefined =
      d.vehicle && live
        ? { ...live, ...d.vehicle }
        : (d.vehicle ??
          live ??
          (d.proposedStock
            ? {
                stock: d.proposedStock,
                loc: "LOT",
                year: new Date().getUTCFullYear(),
                makeModel: `Stock #${d.proposedStock}`,
                desc: "",
                miles: 0,
                price: d.deal?.price ?? DEFAULT_DEAL.price,
                days: 0,
                stat: "S",
                vin: "",
                epaMpg: d.deal?.mpg ?? null,
                estMaint: d.deal?.maint ?? null,
              }
            : undefined));
    if (v) {
      applyVehicle(v, false);
      void lookupSpecs(v, !!d.deal);
    } else {
      setPinned(null);
    }
    if (d.deal) setDeal(d.deal);
    if (d.current) setCurrent(d.current);
    setTradeCar(d.tradeCar);
    setLookupKey((k) => k + 1);
    setActiveDeal(d);
    toast.success(`Opened ${d.customerName}'s deal`);
  };

  const buildDraft = (meta: { customerName: string; customerPhone: string; notes: string }) => ({
    ...meta,
    vehicle: selected,
    tradeCar,
    deal,
    current,
  });

  const sim = useMemo(() => simulate(deal, current, selected.miles), [deal, current, selected.miles]);
  const bookValue = useMemo(
    () =>
      calculateBookValue({
        year: selected.year,
        make: makeFromModel(selected.makeModel),
        bodyClass: `${selected.makeModel} ${selected.desc}`,
        baseMsrp: null,
        miles: selected.miles,
      }),
    [selected.year, selected.makeModel, selected.desc, selected.miles],
  );
  const belowRetail = bookValue.dealerRetail - deal.price;
  const ltv = useMemo(() => evaluateLtv(sim.financed, bookValue.tradeInClean), [sim.financed, bookValue.tradeInClean]);
  const month = Math.min(Math.max(1, scrub), deal.term);
  const point = sim.series[month] ?? sim.series[sim.series.length - 1]!;
  const odo = odometerAt(selected.miles, sim.annualMiles, month);
  const title = `${selected.year} ${selected.makeModel} ${selected.desc}`.trim();
  const specBadge = spec.mpg != null && deal.mpg === spec.mpg && (spec.status === "epa" || spec.status === "estimate") ? spec.status : null;

  const breakevenText =
    sim.breakevenMonth === 0
      ? "Positive equity from day one"
      : sim.breakevenMonth
        ? `Positive equity at month ${sim.breakevenMonth}`
        : "Upside down through the term";

  const script = useMemo(() => {
    const saves = sim.trueDelta >= 0;
    const lines = [
      `Right now you're spending about ${money(sim.currentTotal)} a month on your current car: ${money(current.currPay)} payment, ${money(sim.currGas)} in gas and ${money(current.currMaint)} in repairs.`,
      `In the ${title}, your payment would be ${money(sim.payment)}. At ${deal.mpg} MPG you ${sim.gasSave >= 0 ? `save ${money(sim.gasSave)}` : `spend ${money(-sim.gasSave)} more`} on gas, and maintenance ${sim.maintSave >= 0 ? `drops by ${money(sim.maintSave)}` : `rises by ${money(-sim.maintSave)}`} a month.`,
      saves
        ? `All in, you actually keep ${money(sim.trueDelta)} more in your pocket every month.`
        : `All in, that's only ${money(-sim.trueDelta)} a month more out of pocket — about ${money(-sim.trueDelta / 30)} a day — for a newer, warrantied vehicle.`,
      sim.breakevenMonth != null && sim.breakevenMonth > 0
        ? `And by month ${sim.breakevenMonth} you're building positive trade equity.`
        : sim.breakevenMonth === 0
          ? "And you start with positive equity from day one."
          : "",
    ];
    return lines.filter(Boolean).join(" ");
  }, [sim, current.currPay, current.currMaint, deal.mpg, title]);

  // Term cards + "$1,000 more down" only depend on the loan side of the deal and yearly miles,
  // so dragging MPG, repairs, gas price or the month scrubber doesn't recompute them.
  const { price, cash, tradeValue, tradePayoff, taxRate, tradeTaxCredit, fees, apr, term } = deal;
  const yearMiles = sim.annualMiles;
  const termOptions = useMemo(() => {
    const loan = { price, cash, tradeValue, tradePayoff, taxRate, tradeTaxCredit, fees, apr };
    return TERMS.map((t) => {
      const q = quickDeal({ ...loan, term: t }, yearMiles);
      return { term: t, payment: q.payment, breakeven: q.breakevenMonth };
    });
  }, [price, cash, tradeValue, tradePayoff, taxRate, tradeTaxCredit, fees, apr, yearMiles]);
  const moreDown = useMemo(
    () => quickDeal({ price, cash: cash + 1000, tradeValue, tradePayoff, taxRate, tradeTaxCredit, fees, apr, term }, yearMiles),
    [price, cash, tradeValue, tradePayoff, taxRate, tradeTaxCredit, fees, apr, term, yearMiles],
  );
  const milestones = useMemo(
    () => chartMilestones(selected.year, selected.miles, sim.annualMiles, sim.breakevenMonth, deal.term),
    [selected.year, selected.miles, sim.annualMiles, sim.breakevenMonth, deal.term],
  );
  const depRatePct = Math.round(annualDepreciationRate(sim.annualMiles) * 1000) / 10;
  const activePill = SERVICE_PILLS.find((p) => p.monthly === current.currMaint) ?? null;

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      toast.error("Couldn't copy to clipboard");
      return false;
    }
  };

  const shareSummary = async () => {
    const code = encodeSummary({ title, startMiles: selected.miles, modelYear: selected.year, deal, current });
    const url = `${window.location.origin}/summary?d=${code}`;
    const text = `Here's the summary for the ${title}: ${money(sim.payment)}/mo, feels like ${money(sim.feelsLike)}/mo.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Your deal summary", text, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    if (await copyText(url)) {
      toast.success("Summary link copied", { action: { label: "Open", onClick: () => window.open(url, "_blank") } });
    }
  };

  const show = (t: Tab) => cn(tab === t ? "block" : "hidden", "lg:block");
  const quick = inventory.slice(0, 8);

  return (
    <div className="min-h-dvh bg-background pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-16">
      <IconRail
        active={rail}
        presenting={presenting}
        email={user?.email ?? null}
        dealCount={user ? (savedDeals.data?.length ?? null) : null}
        onTogglePresent={() => setPresenting((p) => !p)}
        onAccount={() => (user ? setOverlay("deals") : askSignIn(null))}
        onSelect={(i) => {
          if (i === "share") return void shareSummary();
          setRail(i);
          if (i === "inventory" || i === "deals") setOverlay(i);
          else if (i === "equity") document.getElementById("equity-bento")?.scrollIntoView({ behavior: "smooth", block: "start" });
          else window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-4 py-3 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <img src="/icons/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl lg:hidden" />
            <div className="min-w-0 flex-1 lg:w-56 lg:flex-none">
              <h1 className="truncate text-base font-semibold leading-tight">
                {activeDeal && !presenting ? activeDeal.customerName : "DealShift"}
              </h1>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {sheet.status === "syncing" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                <span className="truncate">
                  {presenting ? (
                    "Customer view"
                  ) : (
                    <>
                      {sheet.status === "syncing" ? "Loading shared sheet…" : source}
                      {sheet.status === "error" && " · sheet offline"}
                    </>
                  )}
                </span>
              </p>
            </div>
            <div className="order-last w-full lg:order-none lg:w-auto lg:flex-1">
              <CommandSearch
                inventory={inventory}
                deals={user && !presenting ? (savedDeals.data ?? []) : []}
                hideInternal={presenting}
                onPickVehicle={(v) => {
                  applyVehicle(v);
                  toast.success(`Loaded #${v.stock}`);
                }}
                onPickDeal={loadSavedDeal}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-10 px-2.5 lg:hidden", presenting && "border-gain/60 bg-gain/15 text-gain")}
              onClick={() => setPresenting((p) => !p)}
              aria-pressed={presenting}
              aria-label={presenting ? "Customer View on — switch to Desk View (Alt+C)" : "Desk View — switch to Customer View (Alt+C)"}
            >
              {presenting ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            {!presenting && (
              <>
                <SaveCustomerPopover
                  {...overlayProps("save")}
                  activeDeal={activeDeal}
                  buildDraft={buildDraft}
                  onSaved={setActiveDeal}
                  signedIn={!!user}
                  onNeedSignIn={() => askSignIn("Sign in to save this customer and their deal to your account.", true)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="relative h-10 lg:hidden"
                  onClick={() => setOverlay("deals")}
                  aria-label={`My customers${savedDeals.data ? ` (${savedDeals.data.length})` : ""}`}
                >
                  <Users className="h-4 w-4" />
                  {user && savedDeals.data && (
                    <span className="num absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {savedDeals.data.length}
                    </span>
                  )}
                </Button>
              </>
            )}
          </div>

          <div className={cn("no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0", presenting && "hidden")}>
            {quick.map((v) => (
              <button
                key={v.stock}
                onClick={() => applyVehicle(v)}
                className={cn(
                  "num shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors",
                  v.stock === selected.stock
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground active:bg-accent",
                )}
              >
                #{v.stock}
              </button>
            ))}
          </div>
        </div>

        {/* Always-visible numbers on phones */}
        <div className="grid grid-cols-2 border-t border-border lg:hidden">
          <div className="px-4 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment</div>
            <div className="num text-lg font-bold">{money(sim.payment)}<span className="text-xs font-medium text-muted-foreground">/mo</span></div>
          </div>
          <div className="border-l border-border px-4 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Real cash flow</div>
            <div className={cn("num text-lg font-bold", sim.trueDelta >= 0 ? "text-gain" : "text-cost")}>
              {sim.trueDelta >= 0 ? "Saves " : "Adds "}
              {money(Math.abs(sim.trueDelta))}
              <span className="text-xs font-medium text-muted-foreground">/mo</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-4 pt-4 lg:grid-cols-12 lg:gap-5 lg:px-6 lg:pt-5">
        <div className="space-y-4 lg:col-span-4">
          {/* Proposed vehicle */}
          <section className={cn(show("deal"), "overflow-hidden rounded-2xl border border-border bg-card")}>
            <div className="bg-gradient-to-br from-primary/15 via-transparent to-transparent p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Proposed unit</div>
                  <h2 className="mt-1 text-xl font-semibold leading-tight">{title}</h2>
                </div>
                <span className="num shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">#{selected.stock}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Chip icon={<Gauge className="h-3.5 w-3.5" />} label="Odometer" value={`${num(selected.miles)} mi`} />
                <Chip
                  icon={<Fuel className="h-3.5 w-3.5" />}
                  label="Fuel economy"
                  value={`${deal.mpg} MPG`}
                  sub={selected.cityMpg && selected.hwyMpg ? `${selected.cityMpg} city / ${selected.hwyMpg} hwy` : undefined}
                  badge={specBadge ? <SpecBadge kind={specBadge} /> : undefined}
                />
                <Chip icon={<Wrench className="h-3.5 w-3.5" />} label="Maintenance" value={`${money(deal.maint)}/mo`} />
                {!presenting && (
                  <>
                    <Chip icon={<CalendarClock className="h-3.5 w-3.5" />} label="On lot" value={`${selected.days} days`} />
                    <Chip icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={`${selected.loc} · ${selected.stat || "S"}`} />
                  </>
                )}
                <Chip
                  icon={spec.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Car className="h-3.5 w-3.5" />}
                  label="Engine"
                  value={spec.status === "loading" && !selected.engine ? "Checking EPA…" : selected.engine || "—"}
                  sub={
                    spec.engineFrom === "sheet"
                      ? "From your sheet"
                      : spec.status === "epa"
                        ? "Matched on fueleconomy.gov"
                        : spec.status === "estimate"
                          ? "From VIN decode"
                          : undefined
                  }
                />
              </div>
              {selected.vin && <div className="num mt-3 truncate text-xs text-muted-foreground">VIN {selected.vin}</div>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold uppercase tracking-wider text-muted-foreground">Market Book Value</span>
                  <span>
                    Retail <strong className="num text-foreground">{money(bookValue.dealerRetail)}</strong>
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span>
                    Clean Trade <strong className="num text-foreground">{money(bookValue.tradeInClean)}</strong>
                  </span>
                </div>
                {belowRetail > 0 && (
                  <span className="num inline-flex items-center rounded-full border border-gain/40 bg-gain/15 px-2.5 py-0.5 text-[11px] font-semibold text-gain">
                    Priced {money(belowRetail)} below market retail
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Deal structure */}
          <Panel title="Deal structure" kicker="Desk" className={show("deal")}>
            <div className="space-y-6">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    Market Book Value:{" "}
                    <strong className="num text-foreground">{money(bookValue.dealerRetail)}</strong> retail ·{" "}
                    <strong className="num text-foreground">{money(bookValue.tradeInClean)}</strong> clean trade
                  </span>
                  {belowRetail > 0 && (
                    <span className="num rounded-full bg-gain/15 px-2 py-0.5 font-semibold text-gain">
                      Priced {money(belowRetail)} below market retail
                    </span>
                  )}
                </div>
                <SliderField label="Selling price" value={deal.price} onChange={setD("price")} min={10000} max={75000} step={250} prefix="$" decimals={0} />
              </div>
              <SliderField label="Cash down" value={deal.cash} onChange={setD("cash")} min={0} max={20000} step={250} prefix="$" decimals={0} />
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Trade value">
                    <NumInput label="Trade value" value={deal.tradeValue} onChange={setD("tradeValue")} prefix="$" decimals={0} />
                  </Field>
                  <Field label="Trade payoff">
                    <NumInput label="Trade payoff" value={deal.tradePayoff} onChange={setD("tradePayoff")} prefix="$" decimals={0} />
                  </Field>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Net trade {sim.netTrade < 0 && "(rolled into loan)"}</span>
                  <span className={cn("num font-semibold", sim.netTrade < 0 ? "text-loss" : sim.netTrade > 0 && "text-gain")}>{signedMoney(sim.netTrade)}</span>
                </div>
                {sim.tradeTaxSavings > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
                    <BadgePercent className="h-4 w-4 shrink-0 text-primary" />
                    <span>
                      <strong>Hidden savings:</strong> trade cuts sales tax by <strong className="num text-primary">{money(sim.tradeTaxSavings)}</strong>
                    </span>
                  </div>
                )}
              </div>
              <SliderField label="APR" value={deal.apr} onChange={setD("apr")} min={0} max={18.9} step={0.25} suffix="%" />
              <div className="space-y-2">
                <div className="text-sm font-medium">Term</div>
                <div className="grid grid-cols-4 gap-2">
                  {TERMS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setD("term")(t)}
                      className={cn(
                        "num h-11 rounded-lg border text-sm font-semibold transition-colors",
                        deal.term === t ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background/60 active:bg-accent",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ZIP code (sales tax & gas)</span>
                    {zipInfo && (
                      <span className="inline-flex items-center gap-1 text-xs text-primary">
                        {zipInfo.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                        <span className="font-medium">{zipInfo.region}</span>
                        <span className="num text-muted-foreground">
                          · {deal.taxRate}% tax · ${current.gasPrice.toFixed(2)}/gal
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      inputMode="numeric"
                      enterKeyHint="done"
                      maxLength={5}
                      value={zip}
                      onChange={(e) => handleZipChange(e.target.value)}
                      placeholder="Enter 5-digit ZIP (e.g. 14623)"
                      aria-label="ZIP code for local sales tax and gas price"
                      className="num h-11 w-full rounded-lg border border-input bg-background/60 pl-9 pr-3 text-base font-medium outline-none placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>
                <Field label="Sales tax">
                  <NumInput label="Sales tax rate" value={deal.taxRate} onChange={setD("taxRate")} suffix="%" decimals={3} />
                </Field>
                <Field label="Title & fees">
                  <NumInput label="Title, registration and doc fees" value={deal.fees} onChange={setD("fees")} prefix="$" decimals={0} />
                </Field>
                <Field label="Unit MPG">
                  <NumInput label="Proposed MPG" value={deal.mpg} onChange={setD("mpg")} suffix="mpg" decimals={1} />
                  {specBadge && <SpecBadge kind={specBadge} />}
                </Field>
                <Field label="Unit maint.">
                  <NumInput label="Proposed maintenance per month" value={deal.maint} onChange={setD("maint")} prefix="$" suffix="/mo" decimals={0} />
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">Trade lowers taxable price</span>
                  <span className="block text-xs text-muted-foreground">On in NY and most states</span>
                </span>
                <Switch checked={deal.tradeTaxCredit} onCheckedChange={setD("tradeTaxCredit")} aria-label="Trade lowers taxable price" />
              </label>
              <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Sales tax</span>
                <span className="num font-semibold">{money(sim.salesTax)}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Amount financed</span>
                <span className="num font-semibold">{money(sim.financed)}</span>
              </div>
              <LtvApprovalMeter ltv={ltv} onAddCash={(extra) => setD("cash")(deal.cash + extra)} />
            </div>
          </Panel>

          {/* Current car */}
          <Panel title="Customer's current car" kicker="Today" className={show("costs")}>
            <div className="space-y-6">
              <CurrentCarLookup
                milesPerYear={sim.annualMiles}
                key={lookupKey}
                onEstimate={({ mpg, maint, car }) => {
                  setTradeCar(car);
                  const tradeMSRP = fallbackMsrp(`${car.make} ${car.model} ${car.label}`);
                  const insDelta = estimateInsuranceDelta({
                    tradeYear: car.year,
                    tradeMSRP,
                    proposedMSRP: deal.price || selected.price,
                    proposedYear: selected.year,
                    hasAdvancedSafety: selected.year >= 2020,
                  });
                  setCurrent((c) => ({ ...c, currMpg: mpg ?? c.currMpg, currMaint: maint, insDelta }));
                }}
              />
              {activeDeal && tradeCar?.label && (
                <p className="-mt-3 text-xs text-muted-foreground">
                  Saved trade: <span className="text-foreground">{tradeCar.label}</span>
                  {tradeCar.vin && <span className="num"> · VIN {tradeCar.vin}</span>}
                </p>
              )}
              <SliderField
                label="Daily driving"
                value={current.commute}
                onChange={setC("commute")}
                min={10}
                max={120}
                step={2}
                suffix="mi/day"
                decimals={0}
                hint={`${num(sim.annualMiles)} miles a year · value drops ~${depRatePct}%/yr`}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Current payment">
                  <NumInput label="Current payment" value={current.currPay} onChange={setC("currPay")} prefix="$" suffix="/mo" decimals={0} />
                </Field>
                <Field label="Current MPG">
                  <NumInput label="Current MPG" value={current.currMpg} onChange={setC("currMpg")} suffix="mpg" decimals={1} />
                </Field>
                <div className="col-span-2 space-y-2">
                  <Field label="Current repairs">
                    <NumInput label="Current repairs per month" value={current.currMaint} onChange={setC("currMaint")} prefix="$" suffix="/mo" decimals={0} />
                  </Field>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Upcoming service milestone</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SERVICE_PILLS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        title={p.note}
                        aria-pressed={activePill?.id === p.id}
                        onClick={() => setC("currMaint")(p.monthly)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          activePill?.id === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/60 text-muted-foreground active:bg-accent",
                        )}
                      >
                        {p.label} <span className="num opacity-80">{money(p.monthly)}</span>
                      </button>
                    ))}
                  </div>
                  {activePill && (
                    <div role="note" className="rounded-lg border border-border bg-muted/60 p-2.5 text-xs">
                      <div className="text-muted-foreground">{activePill.note}</div>
                      <ul className="mt-1.5 space-y-0.5">
                        {activePill.parts.map((x) => (
                          <li key={x.k} className="flex justify-between gap-2">
                            <span>{x.k}</span>
                            <span className="num">{money(x.v)}/mo</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <Field label="ZIP code">
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      inputMode="numeric"
                      enterKeyHint="done"
                      maxLength={5}
                      value={zip}
                      onChange={(e) => handleZipChange(e.target.value)}
                      placeholder="5-digit ZIP"
                      aria-label="ZIP code for local gas price and sales tax"
                      className="num h-11 w-full rounded-lg border border-input bg-background/60 pl-8 pr-3 text-base font-medium outline-none placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </Field>
                <Field label="Gas price">
                  <NumInput label="Gas price per gallon" value={current.gasPrice} onChange={setC("gasPrice")} prefix="$" suffix="/gal" />
                </Field>
                {zipInfo && (
                  <div className="col-span-2 -mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {zipInfo.loading ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : <MapPin className="h-3 w-3 text-primary" />}
                    <span>
                      Local rates for <strong className="text-foreground">{zipInfo.region}</strong>: gas{" "}
                      <strong className="num text-foreground">${current.gasPrice.toFixed(2)}/gal</strong> · sales tax{" "}
                      <strong className="num text-foreground">{deal.taxRate}%</strong>
                    </span>
                  </div>
                )}
                <div className="col-span-2">
                  <SliderField
                    label="Insurance change"
                    value={current.insDelta}
                    onChange={setC("insDelta")}
                    min={-50}
                    max={100}
                    step={1}
                    prefix="$"
                    suffix="/mo"
                    decimals={0}
                    allowNegative
                    hint={
                      tradeCar
                        ? `Auto-estimated from #${selected.stock} vs. ${tradeCar.year ?? ""} ${tradeCar.model || tradeCar.make || "trade"}`
                        : "Estimated monthly change · adjust if customer has a carrier quote"
                    }
                  />
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-8">
          {/* KPIs */}
          <div className={show("deal")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MeshKpi
              mesh="mesh-sage"
              label="Loan Payment"
              sub="Monthly"
              value={money(sim.payment)}
              icon={<Wallet className="h-4 w-4" />}
              badge={<span className={cn("num rounded-full px-2 py-0.5 text-[11px] font-medium", sim.paymentDelta > 0 ? "bg-cost/15 text-cost" : "bg-gain/15 text-gain")}>{signedMoney(sim.paymentDelta)}/mo</span>}
            />
            <MeshKpi
              mesh="mesh-mint"
              label="Running Costs"
              sub={`Gas ${sim.gasSave >= 0 ? "−" : "+"}${money(Math.abs(sim.gasSave))} · Maint ${sim.maintSave >= 0 ? "−" : "+"}${money(Math.abs(sim.maintSave))}`}
              value={`${sim.opSavings >= 0 ? "Saves" : "Adds"} ${money(Math.abs(sim.opSavings))}`}
              valueClass={sim.opSavings >= 0 ? "text-mint" : "text-cost"}
              icon={<span className="flex gap-1"><Fuel className="h-4 w-4" /><Wrench className="h-4 w-4" /></span>}
              badge={<ArrowRight className="h-4 w-4 text-muted-foreground" />}
            />
            <MeshKpi
              mesh="mesh-coral"
              label="Feels Like Payment"
              sub="After gas, repairs & insurance"
              value={money(sim.feelsLike)}
              valueClass="text-gain"
              watermark
              className={cn(presenting && "ring-2 ring-gain/70 ring-offset-2 ring-offset-background")}
              icon={<LineChart className="h-4 w-4" />}
              badge={<span className={cn("num rounded-full px-2 py-0.5 text-[11px] font-semibold", sim.trueDelta >= 0 ? "bg-gain/20 text-gain" : "bg-cost/15 text-cost")}>{sim.trueDelta >= 0 ? "Saves" : "Adds"} {money(Math.abs(sim.trueDelta))}/mo</span>}
            />
          </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
          <section className={cn("timeline-grid rounded-2xl border border-border bg-card p-1", "lg:block", tab === "deal" ? "hidden" : "block")}>
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Outflow & equity timeline</div>
              <div className="flex rounded-full border border-border bg-background p-0.5 text-xs">
                {([["Today", 1], ["Term", deal.term]] as const).map(([l, m]) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setScrub(m)}
                    className={cn("rounded-full px-3 py-1", month === m ? "bg-accent text-foreground" : "text-muted-foreground")}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="num hidden grid-cols-6 px-3 pt-1 text-[10px] text-muted-foreground/70 sm:grid">
              {[12, 24, 36, 48, 60, 72].map((m) => (
                <span key={m}>Month {m}</span>
              ))}
            </div>

          {/* Compare */}
          <Panel
            title="Total monthly outflow"
            kicker="Side by side"
            className={cn("border-0 bg-transparent", presenting && "present-panel")}
            action={
              <Button variant="ghost" size="sm" className="h-9 text-primary" onClick={() => void shareSummary()}>
                <Send className="h-4 w-4" /> Send
              </Button>
            }
          >
            <CompareBars
              rows={[
                {
                  label: "Current car",
                  parts: [
                    { k: "Payment", v: current.currPay, c: "bg-sage text-sage" },
                    { k: "Gas", v: sim.currGas, c: "bg-cyan text-cyan" },
                    { k: "Repairs", v: current.currMaint, c: "bg-coral text-coral" },
                  ],
                },
                {
                  label: `Stock #${selected.stock}`,
                  parts: [
                    { k: "Payment", v: sim.payment, c: "bg-sage text-sage" },
                    { k: "Gas", v: sim.propGas, c: "bg-cyan text-cyan" },
                    { k: "Repairs", v: deal.maint, c: "bg-coral text-coral" },
                    { k: current.insDelta < 0 ? "Insurance" : "Insurance +", v: current.insDelta, c: "bg-amber text-amber" },
                  ],
                },
              ]}
            />
            <div className={cn("mt-4 rounded-xl p-3 text-center text-sm font-semibold", sim.trueDelta >= 0 ? "bg-gain/15 text-gain" : "bg-cost/15 text-cost")}>
              {sim.trueDelta >= 0
                ? `Customer keeps ${money(sim.trueDelta)} more every month`
                : `${money(-sim.trueDelta)}/mo more — ${money(-sim.trueDelta / 30)} a day`}
            </div>
          </Panel>

          {/* Equity */}
          <div id="equity-bento" className="scroll-mt-40" />
          <Panel
            title="Equity crossover"
            kicker="Depreciation twin"
            className={cn("border-0 bg-transparent", presenting && "present-panel")}
            action={
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", sim.breakevenMonth != null ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>
                {breakevenText}
              </span>
            }
          >
            <div className="mb-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-full bg-gain" /> Est. trade value</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-full bg-cost" /> Loan payoff</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Value drops about <strong className="num text-foreground">{depRatePct}%/yr</strong> at {num(sim.annualMiles)} mi/yr
              {sim.annualMiles > BASELINE_MILES + 500
                ? ` (faster: ${num(sim.annualMiles - BASELINE_MILES)} over the 12,000 baseline)`
                : sim.annualMiles < BASELINE_MILES - 500
                  ? ` (slower: ${num(BASELINE_MILES - sim.annualMiles)} under the 12,000 baseline)`
                  : " (12,000 baseline)"}
            </p>
            <div className="mb-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Compare terms</div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    setPinned((p) =>
                      p ? null : { term: deal.term, cash: deal.cash, payment: sim.payment, breakeven: sim.breakevenMonth, series: sim.series },
                    )
                  }
                >
                  {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  {pinned ? "Unpin" : "Pin this deal"}
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {termOptions.map((o) => (
                  <button
                    key={o.term}
                    type="button"
                    onClick={() => setD("term")(o.term)}
                    className={cn(
                      "relative rounded-lg border bg-background/90 px-3 py-2 text-left transition-colors before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full after:absolute after:inset-y-1.5 after:right-0 after:w-[3px] after:rounded-full",
                      deal.term === o.term
                        ? "border-primary/50 before:bg-primary after:bg-primary before:shadow-[0_0_8px_var(--primary)] after:shadow-[0_0_8px_var(--primary)]"
                        : "border-border before:bg-cyan/50 after:bg-cyan/50 hover:bg-accent",
                    )}
                  >
                    <div className="num text-sm font-semibold">{o.term} mo</div>
                    <div className="num text-xs text-muted-foreground">{money(o.payment)}/mo</div>
                    <div className={cn("num mt-1 text-[11px] font-medium", o.breakeven != null ? "text-gain" : "text-loss")}>
                      {o.breakeven === 0 ? "Equity day 1" : o.breakeven ? `Equity mo ${o.breakeven}` : "Upside down"}
                    </div>
                  </button>
                ))}
              </div>
              {pinned ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-muted-foreground align-middle" />
                  Pinned: {pinned.term} mo, {money(pinned.payment)}/mo,{" "}
                  {pinned.breakeven === 0 ? "equity from day one" : pinned.breakeven != null ? `equity at month ${pinned.breakeven}` : "upside down"}
                  {pinned.breakeven != null && sim.breakevenMonth != null && pinned.breakeven !== sim.breakevenMonth && (
                    <strong className={cn("ml-1", sim.breakevenMonth < pinned.breakeven ? "text-gain" : "text-loss")}>
                      → now month {sim.breakevenMonth} ({Math.abs(pinned.breakeven - sim.breakevenMonth)} months{" "}
                      {sim.breakevenMonth < pinned.breakeven ? "sooner" : "later"})
                    </strong>
                  )}
                </p>
              ) : (
                moreDown.breakevenMonth != null &&
                sim.breakevenMonth != null &&
                moreDown.breakevenMonth < sim.breakevenMonth && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    With $1,000 more down: {money(moreDown.payment)}/mo and equity at month{" "}
                    <strong className="text-gain">{moreDown.breakevenMonth}</strong> ({sim.breakevenMonth - moreDown.breakevenMonth} months sooner)
                  </p>
                )
              )}
            </div>
            <EquityChart
              series={sim.series}
              month={month}
              breakeven={sim.breakevenMonth}
              onScrub={setScrub}
              pinned={pinned}
              milestones={milestones}
              tooltip={{ vehicle: `#${selected.stock} ${selected.year} ${selected.makeModel}`, odometer: odo }}
            />
            <p className="mt-1 text-center text-[11px] text-muted-foreground">Drag across the chart, use the slider, or tap a milestone</p>
            <MilestoneChips m={milestones} onJump={setScrub} active={month} />

            <div className="mt-4 rounded-xl border border-border bg-background/50 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <strong className="num text-sm">Month {month} <span className="text-muted-foreground">(Year {(month / 12).toFixed(1)})</span></strong>
                <strong className={cn("num text-sm", point.equity >= 0 ? "text-gain" : "text-loss")}>
                  {point.equity >= 0 ? `+${money(point.equity)} equity` : `${money(point.equity)} upside down`}
                </strong>
              </div>
              <Slider aria-label="Month" className="my-4 py-2" value={[month]} min={1} max={deal.term} step={1} onValueChange={([v]) => setScrub(v ?? 1)} />
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Est. value" value={money(point.value)} className="text-gain" />
                <Stat label="Loan payoff" value={money(point.balance)} className="text-cost" />
                <Stat label="Odometer" value={`${num(odo)}`} sub="mi" />
              </div>
            </div>
          </Panel>
          </section>

          {/* Script */}
          {!presenting && (
          <Panel title="Closing talk track" kicker="Say it like this" className={show("equity")}>
            <p className="text-[15px] leading-relaxed">{script}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="h-11"
                onClick={async () => {
                  if (await copyText(script)) toast.success("Copied");
                }}
              >
                <Copy className="h-4 w-4" /> Copy
              </Button>
              <Button
                className="h-11"
                onClick={async () => {
                  const text = `${title} (#${selected.stock})\n${script}`;
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: "Deal summary", text });
                    } catch {
                      /* share cancelled */
                    }
                  } else if (await copyText(text)) {
                    toast.success("Copied — sharing isn't available on this device");
                  }
                }}
              >
                <Share2 className="h-4 w-4" /> Share
              </Button>
            </div>
          </Panel>
          )}
          </div>

          <RightWidgets
            visibleClass={show("equity")}
            presenting={presenting}
            trueDelta={sim.trueDelta}
            feelsLike={sim.feelsLike}
            salesTax={sim.salesTax}
            financed={sim.financed}
            taxRate={deal.taxRate}
            tradeTaxCredit={deal.tradeTaxCredit}
            onTradeTaxCredit={setD("tradeTaxCredit")}
            onPresenting={setPresenting}
            pinned={!!pinned}
            onPinned={(on) =>
              setPinned(on ? { term: deal.term, cash: deal.cash, payment: sim.payment, breakeven: sim.breakevenMonth, series: sim.series } : null)
            }
            onShare={() => void shareSummary()}
            onSave={() => setOverlay("save")}
            currMaint={current.currMaint}
            onPill={setC("currMaint")}
            recent={!presenting && user ? (savedDeals.data ?? []).slice(0, 4) : null}
            onOpenDeal={loadSavedDeal}
            onAllDeals={() => setOverlay("deals")}
          />
          </div>
        </div>
      </main>

      {/* Bottom nav (phones / tablets) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden" aria-label="Sections">
        <div className={cn("mx-auto grid max-w-lg", presenting ? "grid-cols-3" : "grid-cols-4")}>
          <NavBtn active={tab === "deal"} onClick={() => setTab("deal")} icon={<Wallet className="h-5 w-5" />} label="Deal" />
          <NavBtn active={tab === "costs"} onClick={() => setTab("costs")} icon={<Fuel className="h-5 w-5" />} label="Costs" />
          <NavBtn active={tab === "equity"} onClick={() => setTab("equity")} icon={<LineChart className="h-5 w-5" />} label="Equity" />
          {!presenting && <NavBtn active={overlay === "inventory"} onClick={() => setOverlay("inventory")} icon={<Warehouse className="h-5 w-5" />} label="Stock" />}
        </div>
      </nav>

      <InventoryPanel
        {...overlayProps("inventory")}
        inventory={inventory}
        source={source}
        selectedStock={selected.stock}
        sheetError={sheet.error}
        onSelect={(v) => applyVehicle(v)}
        onReplace={(list, src) => replace(list, src)}
      />
      <SavedDealsPanel
        {...overlayProps("deals")}
        activeDeal={activeDeal}
        onLoad={loadSavedDeal}
        onDeleted={(id) => activeDeal?.id === id && setActiveDeal(null)}
        onNewCustomer={() => {
          setActiveDeal(null);
          setTradeCar(null);
          setCurrent((c) => ({ ...DEFAULT_CURRENT, gasPrice: zip.length === 5 ? c.gasPrice : DEFAULT_CURRENT.gasPrice }));
          setLookupKey((k) => k + 1);
          toast("Next save creates a new customer");
        }}
        onSignIn={() => {
          setOverlay(null);
          askSignIn(null);
        }}
      />
      <AuthDialog open={auth.open} onOpenChange={(open) => setAuth((a) => ({ ...a, open }))} reason={auth.reason} />
    </div>
  );
}

function NavBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={() => {
        onClick();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground")}
    >
      <span className={cn("rounded-full px-4 py-1 transition-colors", active && "bg-primary/15")}>{icon}</span>
      {label}
    </button>
  );
}

function Chip({ icon, label, value, sub, badge }: { icon: ReactNode; label: string; value: string; sub?: string | undefined; badge?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      {badge && <div className="mt-1">{badge}</div>}
      <div className="num mt-1 truncate text-sm font-semibold">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-lg bg-muted p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-sm font-bold", className)}>
        {value}
        {sub && <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

const LTV_MIN = 60;
const LTV_MAX = 140;
const ltvPos = (pct: number) => Math.min(100, Math.max(0, ((pct - LTV_MIN) / (LTV_MAX - LTV_MIN)) * 100));

function LtvApprovalMeter({ ltv, onAddCash }: { ltv: LtvAssessment; onAddCash: (extra: number) => void }) {
  const markerPct = ltvPos(ltv.ltvPct);
  const bookTick = ltvPos(100);
  const stdCapTick = ltvPos(115);
  const maxCapTick = ltvPos(125);

  const toneClass =
    ltv.status === "strong"
      ? "border-gain/40 bg-gain/15 text-gain"
      : ltv.status === "good"
        ? "border-primary/40 bg-primary/15 text-primary"
        : ltv.status === "stretch"
          ? "border-cost/40 bg-cost/15 text-cost"
          : "border-loss/40 bg-loss/15 text-loss";

  const valueTextClass =
    ltv.status === "strong"
      ? "text-gain"
      : ltv.status === "good"
        ? "text-primary"
        : ltv.status === "stretch"
          ? "text-cost"
          : "text-loss";

  const overUnderText =
    ltv.overBookPct > 0
      ? `+${Math.round(ltv.overBookPct)}% over book`
      : ltv.overBookPct < 0
        ? `${Math.abs(Math.round(ltv.overBookPct))}% under book`
        : "At book value";

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-background/60 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Loan-to-Value (LTV) vs. Clean Book ({money(ltv.bookValue)})
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className={cn("num text-xl font-bold", valueTextClass)}>{Math.round(ltv.ltvPct)}% LTV</span>
            <span className="num text-xs font-medium text-muted-foreground">({overUnderText})</span>
          </div>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", toneClass)}>
          {ltv.label}
        </span>
      </div>

      {/* Segmented LTV gauge bar (60% – 140% scale) */}
      <div className="pt-1">
        <div className="relative h-3 w-full rounded-full bg-muted">
          <div className="flex h-full w-full overflow-hidden rounded-full">
            <div className="h-full bg-gain/75" style={{ width: `${bookTick}%` }} title="≤100% Book Value (High approval odds)" />
            <div className="h-full bg-primary/75" style={{ width: `${stdCapTick - bookTick}%` }} title="100%–115% Standard Advance (Good approval odds)" />
            <div className="h-full bg-cost/80" style={{ width: `${maxCapTick - stdCapTick}%` }} title="115%–125% High LTV Stretch (Conditional)" />
            <div className="h-full flex-1 bg-loss/80" title=">125% Over Typical Lender Cap" />
          </div>
          {/* Threshold ticks */}
          <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-background/90" style={{ left: `${bookTick}%` }} />
          <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-background/90" style={{ left: `${stdCapTick}%` }} />
          <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-background/90" style={{ left: `${maxCapTick}%` }} />
          {/* Live LTV marker */}
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-md transition-all"
            style={{ left: `${markerPct}%` }}
            aria-hidden
          />
        </div>
        <div className="relative mt-1.5 h-3.5 text-[10px] text-muted-foreground">
          <span className="num absolute left-0">60%</span>
          <span className="num absolute -translate-x-1/2 font-medium text-foreground" style={{ left: `${bookTick}%` }}>
            100% Book
          </span>
          <span className="num absolute -translate-x-1/2" style={{ left: `${stdCapTick}%` }}>
            115%
          </span>
          <span className="num absolute -translate-x-1/2" style={{ left: `${maxCapTick}%` }}>
            125% Cap
          </span>
          <span className="num absolute right-0">140%</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
        <span className="text-muted-foreground">{ltv.summary}</span>
        {ltv.cashNeededFor120Cap > 0 ? (
          <button
            type="button"
            onClick={() => onAddCash(ltv.cashNeededFor120Cap)}
            className="num shrink-0 rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1 font-semibold text-primary transition-colors active:bg-primary/25"
          >
            +{money(ltv.cashNeededFor120Cap)} down → 120% cap
          </button>
        ) : (
          <span className="num shrink-0 text-muted-foreground">
            <strong className="text-foreground">{money(ltv.cushionTo120Cap)}</strong> room under 120% cap
          </span>
        )}
      </div>
    </div>
  );
}

function MeshKpi({ mesh, label, sub, value, valueClass, icon, badge, watermark, className }: {
  mesh: "mesh-sage" | "mesh-mint" | "mesh-coral"; label: string; sub: string; value: string; valueClass?: string;
  icon: ReactNode; badge: ReactNode; watermark?: boolean; className?: string;
}) {
  return (
    <div className={cn("kpi-mesh flex min-h-40 flex-col rounded-2xl p-4", mesh, className)}>
      {watermark && <span aria-hidden className="pointer-events-none absolute -bottom-6 -right-2 select-none text-8xl font-bold text-foreground/5">$</span>}
      <div className="text-xs font-medium">{label}</div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
      <div className={cn("num mt-3 text-4xl font-light tracking-tight", valueClass)}>
        {value}<span className="text-sm text-muted-foreground">/mo</span>
      </div>
      <div className="mt-auto flex items-center justify-between pt-3">
        <span className="flex h-8 items-center justify-center rounded-lg border border-border bg-foreground/5 px-2 backdrop-blur">{icon}</span>
        {badge}
      </div>
    </div>
  );
}

function RightWidgets(p: {
  visibleClass: string; presenting: boolean; trueDelta: number; feelsLike: number; salesTax: number; financed: number;
  taxRate: number; tradeTaxCredit: boolean; onTradeTaxCredit: (v: boolean) => void; onPresenting: (v: boolean) => void;
  pinned: boolean; onPinned: (on: boolean) => void; onShare: () => void; onSave: () => void;
  currMaint: number; onPill: (v: number) => void; recent: SavedDeal[] | null; onOpenDeal: (d: SavedDeal) => void; onAllDeals: () => void;
}) {
  const box = "rounded-2xl border border-border bg-card p-4";
  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";
  return (
    <div className={cn("space-y-4", p.visibleClass)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <section className={box}>
          <div className={label}>Real cash flow</div>
          <div className={cn("num mt-2 font-mono text-3xl", p.trueDelta >= 0 ? "text-gain" : "text-cost")}>
            {p.trueDelta >= 0 ? "+" : "−"}{money(Math.abs(p.trueDelta))}<span className="text-sm">/mo</span>
          </div>
          <div className="num text-xs text-muted-foreground">{money(p.feelsLike)}/mo feels like</div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={p.onShare} className="h-9 flex-1 rounded-full bg-coral text-sm font-medium text-primary-foreground">Share Summary</button>
            {!p.presenting && <button type="button" onClick={p.onSave} className="h-9 flex-1 rounded-full border border-border bg-background text-sm">Save Customer</button>}
          </div>
        </section>
        <section className={cn(box, "space-y-2.5 text-sm")}>
          <div className={label}>Deal switches</div>
          <label className="flex items-center justify-between gap-2">Trade tax credit ({p.taxRate}%)<Switch checked={p.tradeTaxCredit} onCheckedChange={p.onTradeTaxCredit} /></label>
          <label className="flex items-center justify-between gap-2">Customer View (Alt+C)<Switch checked={p.presenting} onCheckedChange={p.onPresenting} /></label>
          <label className="flex items-center justify-between gap-2">Pin current deal<Switch checked={p.pinned} onCheckedChange={p.onPinned} /></label>
          <div className="num flex justify-between border-t border-border pt-2 text-xs"><span className="text-muted-foreground">Sales tax</span>{money(p.salesTax)}</div>
          <div className="num flex justify-between text-xs"><span className="text-muted-foreground">Amount financed</span>{money(p.financed)}</div>
        </section>
      </div>
      <section className={box}>
        <div className={label}>Service milestones</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SERVICE_PILLS.map((s) => (
            <div key={s.id} className="group relative">
              <button type="button" onClick={() => p.onPill(s.monthly)}
                className={cn("rounded-full border px-3 py-1.5 text-xs", p.currMaint === s.monthly ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                {s.label.split(" ")[0]} <span className="num">{money(s.monthly)}</span>
              </button>
              <div className="glass pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-56 rounded-xl p-2.5 text-[11px] group-hover:block">
                {s.parts.map((x) => <div key={x.k} className="flex justify-between gap-2"><span>{x.k}</span><span className="num">{money(x.v)}</span></div>)}
              </div>
            </div>
          ))}
        </div>
        {p.recent && (
          <>
            <div className="mt-4 flex items-center justify-between"><div className={label}>Recent saved deals</div>
              <button type="button" onClick={p.onAllDeals} className="text-xs text-primary">All</button></div>
            <ul className="mt-2 space-y-1">
              {p.recent.map((d) => {
                const flow = d.deal && d.current ? monthlyCashFlowDelta(d.deal, d.current) : null;
                return (
                  <li key={d.id}>
                    <button type="button" onClick={() => p.onOpenDeal(d)} className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left hover:bg-accent">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sage/40 to-coral/40 text-xs font-semibold">{d.customerName[0]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{d.customerName}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {d.vehicle ? `${d.vehicle.year} ${d.vehicle.makeModel}` : "No unit"} · {new Date(d.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </span>
                      {flow != null && flow >= 0 && <span className="num shrink-0 rounded-full bg-gain/15 px-2 py-0.5 text-[10px] font-semibold text-gain shadow-[0_0_10px_-2px_var(--gain)]">SAVES {money(flow)}/MO</span>}
                    </button>
                  </li>
                );
              })}
              {!p.recent.length && <li className="text-xs text-muted-foreground">No saved customers yet.</li>}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
