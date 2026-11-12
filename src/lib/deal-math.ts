// Pure deal / ownership math shared by the desk screens and tests.

export interface DealInputs {
  price: number;
  cash: number; // cash down
  tradeValue: number; // allowance for the customer's trade
  tradePayoff: number; // what they still owe on the trade
  taxRate: number; // sales tax, percent
  tradeTaxCredit: boolean; // trade allowance lowers the taxable price (NY and most states)
  fees: number; // title, registration & doc fees rolled into the loan
  apr: number; // percent
  term: number; // months
  mpg: number;
  maint: number; // $ / month
}

/** Sales tax, trade tax credit and amount financed for a deal. */
export function dealTax(deal: Pick<DealInputs, "price" | "cash" | "tradeValue" | "tradePayoff" | "taxRate" | "tradeTaxCredit" | "fees">) {
  const trade = Math.max(0, deal.tradeValue);
  const netTrade = trade - Math.max(0, deal.tradePayoff); // negative = rolling in negative equity
  const rate = Math.max(0, deal.taxRate) / 100;
  const credited = deal.tradeTaxCredit ? Math.min(deal.price, trade) : 0;
  const taxable = Math.max(0, deal.price - credited);
  const salesTax = taxable * rate;
  const tradeTaxSavings = credited * rate;
  const financed = Math.max(0, deal.price + salesTax + Math.max(0, deal.fees) - Math.max(0, deal.cash) - netTrade);
  return { netTrade, taxable, salesTax, tradeTaxSavings, financed };
}

export interface CurrentInputs {
  commute: number; // miles per day
  currPay: number;
  currMpg: number;
  currMaint: number;
  gasPrice: number;
  insDelta: number; // extra insurance per month for the proposed unit
}

export function monthlyPayment(principal: number, aprPct: number, term: number): number {
  if (principal <= 0 || term <= 0) return 0;
  const r = aprPct / 1200;
  if (r === 0) return principal / term;
  return (principal * r) / (1 - Math.pow(1 + r, -term));
}

export function loanBalance(
  principal: number,
  aprPct: number,
  term: number,
  month: number,
  pmt = monthlyPayment(principal, aprPct, term),
): number {
  if (principal <= 0) return 0;
  if (month >= term) return 0;
  const r = aprPct / 1200;
  if (r === 0) return Math.max(0, principal - pmt * month);
  const g = Math.pow(1 + r, month);
  return Math.max(0, principal * g - (pmt * (g - 1)) / r);
}

export const annualMiles = (milesPerDay: number) => milesPerDay * 365;

export function monthlyFuelCost(milesPerYear: number, mpg: number, gasPrice: number): number {
  if (mpg <= 0) return 0;
  return (milesPerYear / 12 / mpg) * gasPrice;
}

export function odometerAt(startMiles: number, milesPerYear: number, month: number): number {
  return Math.round(startMiles + (milesPerYear * month) / 12);
}

/** Baseline yearly miles the depreciation curve assumes. */
export const BASELINE_MILES = 12000;

/**
 * Yearly value decay: 12% at 12,000 mi/yr, plus 1.2 points for every 1,000 mi/yr
 * above that (minus 1.2 points per 1,000 below), kept between 5% and 35%.
 */
export function annualDepreciationRate(milesPerYear: number): number {
  const rate = 0.12 + ((milesPerYear - BASELINE_MILES) / 1000) * 0.012;
  return Math.min(0.35, Math.max(0.05, rate));
}

/**
 * Wholesale/trade value estimate: ~8% retail-to-trade gap at drive-off,
 * then the mileage-aware yearly decay above. Never below 10% of price.
 */
export function vehicleValue(
  price: number,
  month: number,
  milesPerYear: number,
  depRate = annualDepreciationRate(milesPerYear),
): number {
  const curve = price * 0.92 * Math.pow(1 - depRate, month / 12);
  return Math.max(price * 0.1, curve);
}

export interface SimPoint {
  month: number;
  value: number;
  balance: number;
  equity: number;
}

export function simulate(deal: DealInputs, current: CurrentInputs, _startMiles = 0) {
  const tax = dealTax(deal);
  const financed = tax.financed;
  const payment = monthlyPayment(financed, deal.apr, deal.term);
  const miles = annualMiles(current.commute);
  const depRate = annualDepreciationRate(miles);

  const currGas = monthlyFuelCost(miles, current.currMpg, current.gasPrice);
  const propGas = monthlyFuelCost(miles, deal.mpg, current.gasPrice);
  const gasSave = currGas - propGas;
  const maintSave = current.currMaint - deal.maint;
  const opSavings = gasSave + maintSave; // positive = proposed is cheaper to run

  const currentTotal = current.currPay + currGas + current.currMaint;
  const proposedTotal = payment + propGas + deal.maint + current.insDelta;
  const trueDelta = currentTotal - proposedTotal; // positive = customer keeps more cash
  const feelsLike = payment - opSavings + current.insDelta;

  const series: SimPoint[] = [];
  let breakevenMonth: number | null = null;
  for (let m = 0; m <= deal.term; m++) {
    const value = vehicleValue(deal.price, m, miles, depRate);
    const balance = loanBalance(financed, deal.apr, deal.term, m, payment);
    const equity = value - balance;
    if (breakevenMonth === null && equity >= 0) breakevenMonth = m;
    series.push({ month: m, value, balance, equity });
  }

  return {
    financed,
    salesTax: tax.salesTax,
    tradeTaxSavings: tax.tradeTaxSavings,
    netTrade: tax.netTrade,
    payment,
    paymentDelta: payment - current.currPay,
    annualMiles: miles,
    currGas,
    propGas,
    gasSave,
    maintSave,
    opSavings,
    currentTotal,
    proposedTotal,
    trueDelta,
    feelsLike,
    series,
    breakevenMonth,
  };
}

export type Simulation = ReturnType<typeof simulate>;

/**
 * Monthly cash-flow difference (`currentTotal - proposedTotal`) without building
 * the month-by-month equity series. Positive means the customer keeps more cash.
 */
export function monthlyCashFlowDelta(deal: DealInputs, current: CurrentInputs): number {
  const { financed } = dealTax(deal);
  const payment = monthlyPayment(financed, deal.apr, deal.term);
  const miles = annualMiles(current.commute);
  const currGas = monthlyFuelCost(miles, current.currMpg, current.gasPrice);
  const propGas = monthlyFuelCost(miles, deal.mpg, current.gasPrice);
  const currentTotal = current.currPay + currGas + current.currMaint;
  const proposedTotal = payment + propGas + deal.maint + current.insDelta;
  return currentTotal - proposedTotal;
}

/**
 * Just the payment and first positive-equity month for a deal — same numbers as
 * `simulate`, without building the month-by-month series. Used for the term
 * comparison cards and the "$1,000 more down" hint, which run on every drag.
 */
export function quickDeal(
  deal: Pick<DealInputs, "price" | "cash" | "tradeValue" | "tradePayoff" | "taxRate" | "tradeTaxCredit" | "fees" | "apr" | "term">,
  milesPerYear: number,
): { payment: number; breakevenMonth: number | null } {
  const financed = dealTax(deal).financed;
  const payment = monthlyPayment(financed, deal.apr, deal.term);
  const depRate = annualDepreciationRate(milesPerYear);
  for (let m = 0; m <= deal.term; m++) {
    if (vehicleValue(deal.price, m, milesPerYear, depRate) - loanBalance(financed, deal.apr, deal.term, m, payment) >= 0) {
      return { payment, breakevenMonth: m };
    }
  }
  return { payment, breakevenMonth: null };
}

/** Ported from the Apps Script fetchPublicSpecsByVin fallback estimator. */
const BRAND_ANNUAL_MAINT: Record<string, number> = {
  TOYOTA: 490,
  HONDA: 510,
  HYUNDAI: 540,
  KIA: 560,
  BUICK: 610,
  FORD: 710,
  CHEVROLET: 730,
  GMC: 740,
  DODGE: 820,
  CHRYSLER: 760,
  RAM: 850,
  JEEP: 790,
};

export function estimateMaint(make: string, odometer: number): number {
  const base = BRAND_ANNUAL_MAINT[make.trim().toUpperCase()] ?? 680;
  const odo = odometer || 15000;
  const factor = 1 + Math.max(0, (odo - 5000) / 40000) * 0.5;
  return Math.round((base * factor) / 12);
}

export function estimateMpg(cylinders: number, displacementL: number, drive: string): number {
  const awd = /4WD|AWD|4X4/i.test(drive);
  if (cylinders >= 8) return displacementL > 6 ? 15 : 17;
  if (cylinders === 6) return awd ? 20 : 22;
  return displacementL <= 1.5 ? 29 : awd ? 25 : 28;
}

/** Guess the make from a "makeModel" string such as "Buick Encore GX". */
export function makeFromModel(makeModel: string): string {
  return (makeModel.split(/\s+/)[0] || "").toUpperCase();
}

/** Mileage choices for the customer's current car; `miles` is the value used for estimates. */
export const MILEAGE_BUCKETS = [
  { label: "Under 25,000", miles: 15000 },
  { label: "25,000 – 50,000", miles: 37500 },
  { label: "50,000 – 75,000", miles: 62500 },
  { label: "75,000 – 100,000", miles: 87500 },
  { label: "100,000 – 125,000", miles: 112500 },
  { label: "125,000 – 150,000", miles: 137500 },
  { label: "150,000 – 200,000", miles: 175000 },
  { label: "200,000+", miles: 215000 },
] as const;

/** When mileage isn't picked, assume 12,000 miles a year of age (minimum one year). */
export function assumedMiles(modelYear: number, currentYear: number): number {
  return Math.max(1, currentYear - modelYear) * 12000;
}

/**
 * AAA "Your Driving Costs" 2025: maintenance, repair & tires for a NEW car,
 * averaged over 5 years / 75,000 miles across five vehicle classes
 * (10.23, 11.91, 10.79, 11.64, 11.79 ¢/mi).
 */
export const AAA_MAINT_CENTS_PER_MILE = 11.3;
export const AAA_SOURCE_URL = "https://newsroom.aaa.com/wp-content/uploads/2025/09/AAA-Brochure-Your-Driving-Cost-9.2025.pdf";

export function aaaMonthlyMaint(milesPerYear: number): number {
  return Math.round((milesPerYear * AAA_MAINT_CENTS_PER_MILE) / 100 / 12);
}

/** Factory coverage most brands use: bumper-to-bumper 3 yr/36k, powertrain 5 yr/60k. */
export const WARRANTY = {
  basic: { months: 36, miles: 36000, label: "Bumper-to-bumper" },
  powertrain: { months: 60, miles: 60000, label: "Powertrain" },
} as const;

export interface WarrantyCliff {
  /** Loan month the coverage runs out (0 = already out at signing). */
  month: number;
  kind: keyof typeof WARRANTY;
  by: "age" | "miles";
}

/**
 * Loan month the remaining factory warranty ends, by age or miles (whichever first).
 * Age is counted from January of the model year — an estimate, since the real
 * in-service date isn't in the sheet. Returns null when both coverages have already ended.
 */
export function warrantyCliff(
  modelYear: number,
  startMiles: number,
  milesPerYear: number,
  now: { year: number; month: number },
): WarrantyCliff | null {
  const ageMonths = Math.max(0, (now.year - modelYear) * 12 + now.month);
  const perMonth = milesPerYear / 12;
  for (const kind of ["basic", "powertrain"] as const) {
    const w = WARRANTY[kind];
    const byAge = w.months - ageMonths;
    const byMiles = perMonth > 0 ? Math.ceil((w.miles - startMiles) / perMonth) : Infinity;
    const month = Math.min(byAge, byMiles);
    if (month > 0) return { month, kind, by: byAge <= byMiles ? "age" : "miles" };
  }
  return null;
}

/**
 * Best months to trade: the 12 months after equity turns positive, ending early
 * if the warranty cliff comes first (but at least 3 months long). Null if never in equity.
 */
export function tradeWindow(breakeven: number | null, cliffMonth: number | null, term: number) {
  if (breakeven == null) return null;
  const start = Math.max(1, breakeven);
  if (start >= term) return null;
  let end = Math.min(term, start + 12);
  if (cliffMonth != null && cliffMonth > start) end = Math.min(end, cliffMonth);
  end = Math.min(term, Math.max(end, start + 3));
  return { start, end };
}

export type BodyCategory = "Truck" | "SUV" | "Sedan";
export type BookCondition = "clean" | "average" | "rough";

const TRUCK_RE =
  /\b(truck|pickup|supercrew|crew\s*cab|double\s*cab|quad\s*cab|f-?150|f-?250|f-?350|silverado|sierra|ram\s*1500|ram\s*2500|tacoma|tundra|ranger|colorado|canyon|frontier|titan|gladiator|maverick|ridgeline)\b/i;
const SUV_RE =
  /\b(suv|crossover|cuv|utility|sport\s*utility|4x4|awd|4wd|rav4|cr-?v|hr-?v|pilot|passport|highlander|4runner|sequoia|venza|corolla\s*cross|equinox|blazer|trailblazer|trax|traverse|tahoe|suburban|encore|envision|enclave|terrain|acadia|yukon|tucson|santa\s*fe|palisade|kona|venue|sportage|sorento|telluride|seltos|soul|cherokee|grand\s*cherokee|wrangler|compass|renegade|wagoneer|durango|hornet|explorer|escape|edge|bronco|expedition|rogue|murano|pathfinder|armada|kicks|outback|forester|crosstrek|ascent|cx-?30|cx-?5|cx-?50|cx-?70|cx-?90|tiguan|atlas|taos|q3|q5|q7|x1|x3|x5|glc|gle|rx|nx|gx|mdx|rdx|xt4|xt5|xt6|escalade|navigator|corsair|aviator|nautilus)\b/i;

/** Categorize a bodyClass or vehicle model/description into Truck, SUV, or Sedan. */
export function inferBodyClass(bodyClass?: string | null): BodyCategory {
  const s = (bodyClass ?? "").trim();
  if (TRUCK_RE.test(s)) return "Truck";
  if (SUV_RE.test(s)) return "SUV";
  return "Sedan";
}

const FALLBACK_MSRP: Record<BodyCategory, number> = {
  Truck: 46000,
  SUV: 36000,
  Sedan: 29000,
};

/** Fallback original MSRP by body style when the exact sticker price isn't known. */
export function fallbackMsrp(bodyClass?: string | null): number {
  return FALLBACK_MSRP[inferBodyClass(bodyClass)];
}

const BASE_CATEGORY_DEPRECIATION: Record<BodyCategory, number> = {
  Truck: 0.115,
  SUV: 0.145,
  Sedan: 0.17,
};

/** Subtle brand retention adjustment around the body-class depreciation rate. */
const BRAND_DEPRECIATION_ADJ: Record<string, number> = {
  TOYOTA: -0.01,
  LEXUS: -0.01,
  HONDA: -0.008,
  SUBARU: -0.006,
  MAZDA: -0.003,
  HYUNDAI: 0,
  KIA: 0,
  FORD: 0,
  CHEVROLET: 0,
  GMC: 0,
  BUICK: 0.003,
  JEEP: 0.003,
  RAM: 0.003,
  DODGE: 0.008,
  CHRYSLER: 0.01,
};

export interface BookValueInputs {
  year: number;
  make: string;
  bodyClass?: string | null | undefined;
  baseMsrp?: number | null | undefined;
  miles: number;
  condition?: BookCondition | undefined;
  currentYear?: number | undefined;
}

export interface BookValueResult {
  tradeInClean: number;
  tradeInAverage: number;
  tradeInRough: number;
  privateParty: number;
  dealerRetail: number;
}

/**
 * Zero-cost algorithmic book value engine.
 * - Uses `baseMsrp` when provided, else falls back by `bodyClass` (Truck: $46k, SUV: $36k, Sedan: $29k).
 * - Applies a first-year drive-off retention of 84%, then a brand- & body-specific annual depreciation rate
 *   (Trucks ~11.5%, SUVs ~14.5%, Sedans ~17%).
 * - Adjusts for mileage against a 12,000 mi/yr baseline (+/- 2.2% per 10k miles).
 */
export function calculateBookValue({
  year,
  make,
  bodyClass,
  baseMsrp,
  miles,
  condition = "average",
  currentYear = new Date().getUTCFullYear(),
}: BookValueInputs): BookValueResult {
  const category = inferBodyClass(bodyClass);
  const msrp = baseMsrp != null && baseMsrp > 0 ? baseMsrp : FALLBACK_MSRP[category];
  const brandAdj = BRAND_DEPRECIATION_ADJ[make.trim().toUpperCase()] ?? 0;
  const annualRate = Math.min(0.28, Math.max(0.06, BASE_CATEGORY_DEPRECIATION[category] + brandAdj));

  const age = Math.max(0, currentYear - year);
  // 84% first-year drive-off retention, followed by compound annual depreciation for subsequent years.
  const ageRetention = 0.84 * Math.pow(1 - annualRate, Math.max(0, age - 1));

  const expectedMiles = Math.max(1, age) * BASELINE_MILES;
  const mileDelta = expectedMiles - Math.max(0, miles);
  const mileageFactor = Math.min(1.25, Math.max(0.65, 1 + (mileDelta / 10000) * 0.022));

  const conditionFactor = condition === "clean" ? 1.06 : condition === "rough" ? 0.9 : 1;
  const baseTrade = Math.max(msrp * 0.1, msrp * ageRetention * mileageFactor * conditionFactor);

  const tradeInAverage = Math.round(baseTrade);
  const tradeInClean = Math.round(baseTrade * 1.07);
  const tradeInRough = Math.round(baseTrade * 0.88);
  const privateParty = Math.round(baseTrade * 1.12);
  const dealerRetail = Math.round(baseTrade * 1.2);

  return {
    tradeInClean,
    tradeInAverage,
    tradeInRough,
    privateParty,
    dealerRetail,
  };
}

export interface InsuranceDeltaInputs {
  tradeYear?: number | null | undefined;
  tradeMSRP: number;
  proposedMSRP: number;
  proposedYear?: number | null | undefined;
  hasAdvancedSafety?: boolean | undefined;
}

/**
 * Algorithmic monthly insurance change estimator.
 * - Replacement cost ratio = `proposedMSRP / tradeMSRP`
 * - Base national premium = $130/mo, scaled by `Math.pow(ratio, 0.35)`
 * - 0.92 multiplier when `hasAdvancedSafety` is true
 * - Subtracts the older trade's estimated premium (`base * 0.85`)
 * - Clamped between $5 and $75/mo
 */
export function estimateInsuranceDelta({
  tradeMSRP,
  proposedMSRP,
  hasAdvancedSafety = true,
}: InsuranceDeltaInputs): number {
  const base = 130;
  const safeTrade = tradeMSRP > 0 ? tradeMSRP : FALLBACK_MSRP.Sedan;
  const safeProposed = proposedMSRP > 0 ? proposedMSRP : FALLBACK_MSRP.Sedan;
  const ratio = safeProposed / safeTrade;
  const safetyMultiplier = hasAdvancedSafety ? 0.92 : 1;
  const proposedPremium = base * Math.pow(ratio, 0.35) * safetyMultiplier;
  const tradePremium = base * 0.85;
  const delta = proposedPremium - tradePremium;
  return Math.round(Math.min(75, Math.max(5, delta)));
}

export interface ZipRateInfo {
  zip: string;
  state: string;
  region: string;
  taxRate: number;
  tradeTaxCredit: boolean;
  gasPrice: number;
}

interface StateRateMeta {
  name: string;
  taxRate: number;
  tradeTaxCredit: boolean;
  gasOffset: number; // $/gal relative to US national regular average
}

const DEFAULT_NATIONAL_GAS = 3.35;

/** Combined auto sales tax rate, trade-in tax credit rule, and regional gas price offset by state. */
const STATE_RATES: Record<string, StateRateMeta> = {
  AL: { name: "Alabama", taxRate: 4.0, tradeTaxCredit: true, gasOffset: -0.32 },
  AK: { name: "Alaska", taxRate: 0.0, tradeTaxCredit: true, gasOffset: 0.55 },
  AZ: { name: "Arizona", taxRate: 8.3, tradeTaxCredit: true, gasOffset: 0.25 },
  AR: { name: "Arkansas", taxRate: 6.5, tradeTaxCredit: true, gasOffset: -0.35 },
  CA: { name: "California", taxRate: 8.85, tradeTaxCredit: false, gasOffset: 1.35 },
  CO: { name: "Colorado", taxRate: 7.8, tradeTaxCredit: true, gasOffset: -0.05 },
  CT: { name: "Connecticut", taxRate: 6.35, tradeTaxCredit: true, gasOffset: 0.1 },
  DE: { name: "Delaware", taxRate: 4.25, tradeTaxCredit: true, gasOffset: -0.08 },
  DC: { name: "Washington, DC", taxRate: 6.0, tradeTaxCredit: false, gasOffset: 0.18 },
  FL: { name: "Florida", taxRate: 7.0, tradeTaxCredit: true, gasOffset: -0.05 },
  GA: { name: "Georgia", taxRate: 7.0, tradeTaxCredit: true, gasOffset: -0.2 },
  HI: { name: "Hawaii", taxRate: 4.5, tradeTaxCredit: false, gasOffset: 1.25 },
  ID: { name: "Idaho", taxRate: 6.0, tradeTaxCredit: true, gasOffset: 0.15 },
  IL: { name: "Illinois", taxRate: 8.25, tradeTaxCredit: true, gasOffset: 0.28 },
  IN: { name: "Indiana", taxRate: 7.0, tradeTaxCredit: true, gasOffset: 0.02 },
  IA: { name: "Iowa", taxRate: 5.0, tradeTaxCredit: true, gasOffset: -0.22 },
  KS: { name: "Kansas", taxRate: 7.5, tradeTaxCredit: true, gasOffset: -0.28 },
  KY: { name: "Kentucky", taxRate: 6.0, tradeTaxCredit: true, gasOffset: -0.22 },
  LA: { name: "Louisiana", taxRate: 9.55, tradeTaxCredit: true, gasOffset: -0.38 },
  ME: { name: "Maine", taxRate: 5.5, tradeTaxCredit: true, gasOffset: 0.05 },
  MD: { name: "Maryland", taxRate: 6.0, tradeTaxCredit: false, gasOffset: 0.02 },
  MA: { name: "Massachusetts", taxRate: 6.25, tradeTaxCredit: true, gasOffset: 0.05 },
  MI: { name: "Michigan", taxRate: 6.0, tradeTaxCredit: true, gasOffset: 0.05 },
  MN: { name: "Minnesota", taxRate: 6.875, tradeTaxCredit: true, gasOffset: -0.12 },
  MS: { name: "Mississippi", taxRate: 5.0, tradeTaxCredit: true, gasOffset: -0.4 },
  MO: { name: "Missouri", taxRate: 7.25, tradeTaxCredit: true, gasOffset: -0.3 },
  MT: { name: "Montana", taxRate: 0.0, tradeTaxCredit: true, gasOffset: -0.05 },
  NE: { name: "Nebraska", taxRate: 6.5, tradeTaxCredit: true, gasOffset: -0.2 },
  NV: { name: "Nevada", taxRate: 8.25, tradeTaxCredit: true, gasOffset: 0.55 },
  NH: { name: "New Hampshire", taxRate: 0.0, tradeTaxCredit: true, gasOffset: -0.02 },
  NJ: { name: "New Jersey", taxRate: 6.625, tradeTaxCredit: true, gasOffset: -0.05 },
  NM: { name: "New Mexico", taxRate: 4.0, tradeTaxCredit: true, gasOffset: -0.18 },
  NY: { name: "New York", taxRate: 8.0, tradeTaxCredit: true, gasOffset: 0.15 },
  NC: { name: "North Carolina", taxRate: 3.0, tradeTaxCredit: true, gasOffset: -0.15 },
  ND: { name: "North Dakota", taxRate: 5.0, tradeTaxCredit: true, gasOffset: -0.18 },
  OH: { name: "Ohio", taxRate: 7.25, tradeTaxCredit: true, gasOffset: -0.08 },
  OK: { name: "Oklahoma", taxRate: 4.5, tradeTaxCredit: false, gasOffset: -0.35 },
  OR: { name: "Oregon", taxRate: 0.5, tradeTaxCredit: true, gasOffset: 0.6 },
  PA: { name: "Pennsylvania", taxRate: 6.0, tradeTaxCredit: true, gasOffset: 0.2 },
  RI: { name: "Rhode Island", taxRate: 7.0, tradeTaxCredit: true, gasOffset: 0.05 },
  SC: { name: "South Carolina", taxRate: 5.0, tradeTaxCredit: true, gasOffset: -0.28 },
  SD: { name: "South Dakota", taxRate: 4.0, tradeTaxCredit: true, gasOffset: -0.15 },
  TN: { name: "Tennessee", taxRate: 7.0, tradeTaxCredit: true, gasOffset: -0.3 },
  TX: { name: "Texas", taxRate: 6.25, tradeTaxCredit: true, gasOffset: -0.35 },
  UT: { name: "Utah", taxRate: 7.15, tradeTaxCredit: true, gasOffset: 0.05 },
  VT: { name: "Vermont", taxRate: 6.0, tradeTaxCredit: true, gasOffset: 0.12 },
  VA: { name: "Virginia", taxRate: 4.15, tradeTaxCredit: false, gasOffset: -0.12 },
  WA: { name: "Washington", taxRate: 9.2, tradeTaxCredit: true, gasOffset: 0.85 },
  WV: { name: "West Virginia", taxRate: 6.0, tradeTaxCredit: true, gasOffset: -0.08 },
  WI: { name: "Wisconsin", taxRate: 5.5, tradeTaxCredit: true, gasOffset: -0.12 },
  WY: { name: "Wyoming", taxRate: 5.25, tradeTaxCredit: true, gasOffset: -0.1 },
};

/** 3-digit ZIP prefix ranges mapped to US state codes. */
const ZIP_PREFIX_RANGES: Array<[number, number, string]> = [
  [5, 5, "NY"],
  [10, 27, "MA"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 459, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [885, 885, "TX"],
  [889, 898, "NV"],
  [900, 961, "CA"],
  [967, 968, "HI"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

/** Metro/county 3-digit ZIP overrides where local sales tax or gas differs from the state baseline. */
const ZIP3_OVERRIDES: Record<number, { region?: string; taxRate?: number; gasOffset?: number }> = {
  100: { region: "New York City, NY", taxRate: 8.875, gasOffset: 0.28 },
  101: { region: "New York City, NY", taxRate: 8.875, gasOffset: 0.28 },
  102: { region: "New York City, NY", taxRate: 8.875, gasOffset: 0.28 },
  103: { region: "Staten Island, NY", taxRate: 8.875, gasOffset: 0.25 },
  104: { region: "Bronx, NY", taxRate: 8.875, gasOffset: 0.25 },
  105: { region: "Westchester, NY", taxRate: 8.375, gasOffset: 0.25 },
  106: { region: "White Plains, NY", taxRate: 8.375, gasOffset: 0.25 },
  107: { region: "Yonkers, NY", taxRate: 8.875, gasOffset: 0.25 },
  108: { region: "New Rochelle, NY", taxRate: 8.375, gasOffset: 0.25 },
  110: { region: "Queens / Nassau, NY", taxRate: 8.625, gasOffset: 0.22 },
  111: { region: "Queens, NY", taxRate: 8.875, gasOffset: 0.25 },
  112: { region: "Brooklyn, NY", taxRate: 8.875, gasOffset: 0.25 },
  113: { region: "Queens, NY", taxRate: 8.875, gasOffset: 0.25 },
  114: { region: "Queens, NY", taxRate: 8.875, gasOffset: 0.25 },
  115: { region: "Nassau County, NY", taxRate: 8.625, gasOffset: 0.2 },
  116: { region: "Queens, NY", taxRate: 8.875, gasOffset: 0.25 },
  117: { region: "Suffolk County, NY", taxRate: 8.625, gasOffset: 0.18 },
  118: { region: "Nassau County, NY", taxRate: 8.625, gasOffset: 0.2 },
  119: { region: "Suffolk County, NY", taxRate: 8.625, gasOffset: 0.22 },
  122: { region: "Albany, NY", taxRate: 8.0, gasOffset: 0.12 },
  132: { region: "Syracuse, NY", taxRate: 8.0, gasOffset: 0.12 },
  142: { region: "Buffalo, NY", taxRate: 8.75, gasOffset: 0.15 },
  146: { region: "Rochester, NY", taxRate: 8.0, gasOffset: 0.14 },
  152: { region: "Pittsburgh, PA", taxRate: 7.0, gasOffset: 0.22 },
  191: { region: "Philadelphia, PA", taxRate: 8.0, gasOffset: 0.22 },
  606: { region: "Chicago, IL", taxRate: 9.5, gasOffset: 0.45 },
  900: { region: "Los Angeles, CA", taxRate: 9.5, gasOffset: 1.45 },
  921: { region: "San Diego, CA", taxRate: 7.75, gasOffset: 1.4 },
  941: { region: "San Francisco, CA", taxRate: 8.625, gasOffset: 1.5 },
  981: { region: "Seattle, WA", taxRate: 10.25, gasOffset: 0.95 },
};

export function stateFromZip(zip: string): string | null {
  const clean = zip.trim();
  if (!/^\d{5}$/.test(clean)) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  for (const [min, max, st] of ZIP_PREFIX_RANGES) {
    if (prefix >= min && prefix <= max) return st;
  }
  return null;
}

/**
 * Look up local sales tax rate, trade-in tax credit rule, and regular gas price for a 5-digit US ZIP code.
 * Uses `nationalRegularGas` when provided (e.g. from the live EIA/EPA fuel price feed), else the baseline average.
 */
export function lookupZipRates(zip: string, nationalRegularGas = DEFAULT_NATIONAL_GAS): ZipRateInfo | null {
  const clean = zip.trim();
  const state = stateFromZip(clean);
  if (!state) return null;
  const meta = STATE_RATES[state];
  if (!meta) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  const override = ZIP3_OVERRIDES[prefix];

  const taxRate = override?.taxRate ?? meta.taxRate;
  const gasOffset = override?.gasOffset ?? meta.gasOffset;
  const baseGas = Number.isFinite(nationalRegularGas) && nationalRegularGas > 1 ? nationalRegularGas : DEFAULT_NATIONAL_GAS;
  const gasPrice = Math.round(Math.max(2.15, baseGas + gasOffset) * 100) / 100;

  return {
    zip: clean,
    state,
    region: override?.region ?? meta.name,
    taxRate,
    tradeTaxCredit: meta.tradeTaxCredit,
    gasPrice,
  };
}

export type LtvStatus = "strong" | "good" | "stretch" | "over";

export interface LtvAssessment {
  /** Loan-to-value percentage (e.g. 108 = 108% of book). */
  ltvPct: number;
  /** Percentage points above (+) or below (-) 100% book value. */
  overBookPct: number;
  /** Book value benchmark used for the advance calculation. */
  bookValue: number;
  /** Amount financed compared against bookValue. */
  financed: number;
  status: LtvStatus;
  label: string;
  summary: string;
  /** Extra cash down needed to reach the 120% standard bank cap (0 if already <= 120%). */
  cashNeededFor120Cap: number;
  /** Remaining advance room before hitting the 120% bank cap. */
  cushionTo120Cap: number;
}

/**
 * Evaluates Loan-to-Value (LTV) and financing approval likelihood based on Amount Financed vs. Book Value.
 * - <= 100% LTV: Strong approval odds (at or under book)
 * - 101%–115% LTV: Good approval odds (standard advance covering tax/fees)
 * - 116%–125% LTV: Conditional / stretch advance (near bank LTV cap; needs strong credit or more down)
 * - > 125% LTV: Low approval odds (exceeds typical 125% lender advance cap)
 */
export function evaluateLtv(financed: number, bookValue: number): LtvAssessment {
  const safeBook = Math.max(1, bookValue);
  const safeFinanced = Math.max(0, financed);
  const rawPct = (safeFinanced / safeBook) * 100;
  const ltvPct = Math.round(rawPct * 10) / 10;
  const overBookPct = Math.round((rawPct - 100) * 10) / 10;
  const cap120 = safeBook * 1.2;
  const cashNeededFor120Cap = Math.max(0, Math.ceil(safeFinanced - cap120));
  const cushionTo120Cap = Math.max(0, Math.floor(cap120 - safeFinanced));

  if (ltvPct <= 100) {
    return {
      ltvPct,
      overBookPct,
      bookValue: safeBook,
      financed: safeFinanced,
      status: "strong",
      label: "High approval odds",
      summary:
        overBookPct < 0
          ? `Financed ${Math.abs(Math.round(overBookPct))}% under book — qualifies for prime lender tiers.`
          : "Financed right at book value — qualifies for prime lender tiers.",
      cashNeededFor120Cap,
      cushionTo120Cap,
    };
  }
  if (ltvPct <= 115) {
    return {
      ltvPct,
      overBookPct,
      bookValue: safeBook,
      financed: safeFinanced,
      status: "good",
      label: "Good approval odds",
      summary: `${Math.round(overBookPct)}% over book — within standard 115% bank advance for tax & fees.`,
      cashNeededFor120Cap,
      cushionTo120Cap,
    };
  }
  if (ltvPct <= 125) {
    return {
      ltvPct,
      overBookPct,
      bookValue: safeBook,
      financed: safeFinanced,
      status: "stretch",
      label: "Conditional · High LTV",
      summary: `${Math.round(overBookPct)}% over book — near the 120%–125% lender cap; may require Tier 1–2 credit.`,
      cashNeededFor120Cap,
      cushionTo120Cap,
    };
  }
  return {
    ltvPct,
    overBookPct,
    bookValue: safeBook,
    financed: safeFinanced,
    status: "over",
    label: "Low odds · Over cap",
    summary: `${Math.round(overBookPct)}% over book — exceeds typical 125% max advance cap.`,
    cashNeededFor120Cap,
    cushionTo120Cap,
  };
}
