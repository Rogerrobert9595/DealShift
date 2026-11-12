import { describe, expect, it } from "vitest";

import {
  aaaMonthlyMaint,
  annualMiles,
  dealTax,
  estimateMaint,
  loanBalance,
  monthlyFuelCost,
  monthlyPayment,
  odometerAt,
  simulate,
  tradeWindow,
  warrantyCliff,
} from "./deal-math";
import { findByStock, parsePastedRows } from "./inventory";
import { decodeSummary, encodeSummary } from "./summary-link";

describe("deal math", () => {
  it("amortizes a 72-month loan at 6.9% APR", () => {
    expect(monthlyPayment(21499, 6.9, 72)).toBeCloseTo(365.5, 0);
  });

  it("splits evenly at 0% APR", () => {
    expect(monthlyPayment(12000, 0, 60)).toBe(200);
  });

  it("pays the loan to zero at the end of the term", () => {
    expect(loanBalance(20000, 6.9, 72, 72)).toBe(0);
    expect(loanBalance(20000, 6.9, 72, 0)).toBeCloseTo(20000, 5);
  });

  it("turns a 42 mile/day commute into 15,330 miles a year", () => {
    expect(annualMiles(42)).toBe(15330);
  });

  it("projects the odometer 3 years out", () => {
    expect(odometerAt(11604, 15330, 36)).toBe(57594);
  });

  it("prices fuel from miles, mpg and gas price", () => {
    expect(monthlyFuelCost(12000, 25, 3.5)).toBeCloseTo(140, 5);
  });

  it("uses the brand maintenance table with a mileage factor", () => {
    expect(estimateMaint("Toyota", 5000)).toBe(41);
    expect(estimateMaint("Unknown", 45000)).toBe(85);
  });

  it("finances price plus fees minus down and finds equity crossover", () => {
    const sim = simulate(
      { price: 23999, cash: 2500, tradeValue: 0, tradePayoff: 0, taxRate: 0, tradeTaxCredit: true, fees: 0, apr: 6.9, term: 72, mpg: 27, maint: 58 },
      { commute: 42, currPay: 310, currMpg: 18, currMaint: 165, gasPrice: 3.45, insDelta: 18 },
      11604,
    );
    expect(sim.financed).toBe(21499);
    expect(sim.maintSave).toBe(107);
    expect(sim.breakevenMonth).not.toBeNull();
    expect(sim.series).toHaveLength(73);
  });
});

describe("trade-in sales tax credit", () => {
  const base = { price: 24000, cash: 0, tradeValue: 5000, tradePayoff: 3000, taxRate: 8, tradeTaxCredit: true, fees: 0 };

  it("taxes only the price minus the trade allowance", () => {
    const t = dealTax(base);
    expect(t.taxable).toBe(19000);
    expect(t.salesTax).toBeCloseTo(1520, 5);
    expect(t.tradeTaxSavings).toBeCloseTo(400, 5);
    // 24,000 + 1,520 tax − 2,000 net trade
    expect(t.financed).toBeCloseTo(23520, 5);
  });

  it("makes $2,000 of trade equity worth more than $2,000 cash", () => {
    const viaTrade = dealTax({ ...base, tradeValue: 2000, tradePayoff: 0 }).financed;
    const viaCash = dealTax({ ...base, tradeValue: 0, tradePayoff: 0, cash: 2000 }).financed;
    expect(viaCash - viaTrade).toBeCloseTo(160, 5);
  });

  it("gives no credit when the state doesn't allow it", () => {
    const t = dealTax({ ...base, tradeTaxCredit: false });
    expect(t.salesTax).toBeCloseTo(1920, 5);
    expect(t.tradeTaxSavings).toBe(0);
  });

  it("rolls negative trade equity into the loan", () => {
    const t = dealTax({ ...base, tradeValue: 5000, tradePayoff: 8000 });
    expect(t.netTrade).toBe(-3000);
    expect(t.financed).toBeCloseTo(24000 + 1520 + 3000, 5);
  });
});

describe("maintenance sources", () => {
  it("applies the AAA 2025 new-car rate of 11.3¢ a mile", () => {
    expect(aaaMonthlyMaint(15330)).toBe(144);
  });
});

describe("share summary link", () => {
  it("round-trips the deal and rejects garbage", () => {
    const payload = {
      title: "2026 Buick Encore GX — AWD",
      startMiles: 11604,
      deal: { ...base(), apr: 6.9, term: 72, mpg: 27, maint: 58 },
      current: { commute: 42, currPay: 310, currMpg: 18, currMaint: 165, gasPrice: 3.45, insDelta: 18 },
    };
    expect(decodeSummary(encodeSummary(payload))).toEqual(payload);
    expect(decodeSummary("not-a-real-code")).toBeNull();
  });

  function base() {
    return { price: 23999, cash: 2500, tradeValue: 0, tradePayoff: 0, taxRate: 8, tradeTaxCredit: true, fees: 375 };
  }
});

describe("pasted sheet rows", () => {
  it("reads a tab-separated row copied from column A", () => {
    const row = ["1", "S", "2-48134", "2026", "Buick Encore GX", "AWD Preferred", "11,604", "$23,999", "39", "S", "KL4AMCSL0TB008832", "", "27", "58"].join("\t");
    const v = parsePastedRows(row)[0]!;
    expect(v.stock).toBe("2-48134");
    expect(v.loc).toBe("S");
    expect(v.miles).toBe(11604);
    expect(v.price).toBe(23999);
    expect(v.epaMpg).toBe(27);
    expect(v.estMaint).toBe(58);
  });

  it("skips header rows and rows without a price", () => {
    const text = "#\tLoc\tStock\tYear\tModel\n1\tS\t2-1\t2024\tKia Soul\tLX\t100\t\t3";
    expect(parsePastedRows(text)).toHaveLength(0);
  });

  it("finds a unit by exact or partial stock number", () => {
    const list = parsePastedRows("S\t1-78825NA\t2024\tToyota RAV4\tXLE\t28000\t29450\t18");
    expect(findByStock(list, "1-78825na")?.makeModel).toBe("Toyota RAV4");
    expect(findByStock(list, "78825")?.stock).toBe("1-78825NA");
  });
});

describe("current car estimates", () => {
  it("assumes 12,000 miles per year of age when mileage isn't picked", async () => {
    const { assumedMiles } = await import("./deal-math");
    expect(assumedMiles(2015, 2026)).toBe(132000);
    expect(assumedMiles(2026, 2026)).toBe(12000);
  });

  it("estimates repairs from the mileage bucket", async () => {
    const { MILEAGE_BUCKETS } = await import("./deal-math");
    // Ford, 125–150k bucket (137,500 mi): 710 × (1 + 3.3125 × 0.5) ÷ 12 ≈ $157/mo
    expect(estimateMaint("Ford", MILEAGE_BUCKETS[5].miles)).toBe(157);
  });
});

describe("warranty cliff", () => {
  const oct2026 = { year: 2026, month: 9 };
  it("ends basic coverage at 36k miles when miles come first", () => {
    // 2026 model, 11,604 mi, 15,330 mi/yr → 24,396 mi left at 1,277.5/mo → month 20
    expect(warrantyCliff(2026, 11604, 15330, oct2026)).toEqual({ month: 20, kind: "basic", by: "miles" });
  });
  it("ends basic coverage at 36 months when age comes first", () => {
    // 2025 model in Oct 2026 = 21 months old → 15 months left
    expect(warrantyCliff(2025, 5000, 6000, oct2026)).toEqual({ month: 15, kind: "basic", by: "age" });
  });
  it("falls back to powertrain once basic is gone", () => {
    expect(warrantyCliff(2023, 40000, 12000, oct2026)?.kind).toBe("powertrain");
  });
  it("is null when both coverages are over", () => {
    expect(warrantyCliff(2019, 90000, 12000, oct2026)).toBeNull();
  });
});

describe("trade window", () => {
  it("runs 12 months from the equity crossover", () => {
    expect(tradeWindow(24, null, 72)).toEqual({ start: 24, end: 36 });
  });
  it("closes early at the warranty cliff", () => {
    expect(tradeWindow(24, 30, 72)).toEqual({ start: 24, end: 30 });
  });
  it("is at least 3 months long", () => {
    expect(tradeWindow(24, 25, 72)).toEqual({ start: 24, end: 27 });
  });
  it("is null when the customer never gets equity", () => {
    expect(tradeWindow(null, 30, 72)).toBeNull();
  });
});

describe("mileage-aware depreciation", () => {
  it("uses 12%/yr at the 12,000 mi/yr baseline", async () => {
    const { annualDepreciationRate, vehicleValue } = await import("./deal-math");
    expect(annualDepreciationRate(12000)).toBeCloseTo(0.12, 10);
    expect(vehicleValue(20000, 12, 12000)).toBeCloseTo(20000 * 0.92 * 0.88, 5);
  });

  it("adds 1.2 points per 1,000 extra miles and removes 1.2 per 1,000 fewer", async () => {
    const { annualDepreciationRate } = await import("./deal-math");
    expect(annualDepreciationRate(15000)).toBeCloseTo(0.156, 10);
    expect(annualDepreciationRate(9000)).toBeCloseTo(0.084, 10);
  });

  it("keeps the yearly rate between 5% and 35%", async () => {
    const { annualDepreciationRate } = await import("./deal-math");
    expect(annualDepreciationRate(1000)).toBe(0.05);
    expect(annualDepreciationRate(60000)).toBe(0.35);
  });

  it("pushes the equity crossover later for a heavier driver", () => {
    const deal = { price: 30000, cash: 0, tradeValue: 0, tradePayoff: 0, taxRate: 8, tradeTaxCredit: true, fees: 375, apr: 6.9, term: 72, mpg: 27, maint: 58 };
    const cur = { commute: 20, currPay: 310, currMpg: 18, currMaint: 165, gasPrice: 3.45, insDelta: 18 };
    const light = simulate(deal, cur, 10000).breakevenMonth!;
    const heavy = simulate(deal, { ...cur, commute: 90 }, 10000).breakevenMonth!;
    expect(heavy).toBeGreaterThan(light);
  });
});

describe("book value & insurance estimator", () => {
  it("calculates book value tiers with fallback MSRP and mileage adjustments", async () => {
    const { calculateBookValue } = await import("./deal-math");
    const suv = calculateBookValue({
      year: 2024,
      make: "Toyota",
      bodyClass: "RAV4 XLE AWD",
      baseMsrp: null,
      miles: 24000,
      currentYear: 2026,
    });
    expect(suv.dealerRetail).toBeGreaterThan(suv.privateParty);
    expect(suv.privateParty).toBeGreaterThan(suv.tradeInClean);
    expect(suv.tradeInClean).toBeGreaterThan(suv.tradeInAverage);
    expect(suv.tradeInAverage).toBeGreaterThan(suv.tradeInRough);

    const highMiles = calculateBookValue({
      year: 2024,
      make: "Toyota",
      bodyClass: "RAV4 XLE AWD",
      baseMsrp: null,
      miles: 64000,
      currentYear: 2026,
    });
    expect(highMiles.dealerRetail).toBeLessThan(suv.dealerRetail);
  });

  it("estimates monthly insurance delta from replacement cost ratio and clamps between $5 and $75", async () => {
    const { estimateInsuranceDelta } = await import("./deal-math");
    const modest = estimateInsuranceDelta({
      tradeYear: 2018,
      tradeMSRP: 36000,
      proposedMSRP: 23999,
      proposedYear: 2026,
      hasAdvancedSafety: true,
    });
    expect(modest).toBe(5);

    const stepUp = estimateInsuranceDelta({
      tradeYear: 2016,
      tradeMSRP: 24000,
      proposedMSRP: 38000,
      proposedYear: 2025,
      hasAdvancedSafety: true,
    });
    expect(stepUp).toBeGreaterThan(20);
    expect(stepUp).toBeLessThanOrEqual(75);
  });

  it("looks up local sales tax rate, trade tax credit rule, and gas price by ZIP code", async () => {
    const { lookupZipRates, stateFromZip } = await import("./deal-math");
    expect(stateFromZip("14623")).toBe("NY");
    expect(stateFromZip("90210")).toBe("CA");

    const ny = lookupZipRates("14623", 3.35);
    expect(ny).toEqual({
      zip: "14623",
      state: "NY",
      region: "Rochester, NY",
      taxRate: 8.0,
      tradeTaxCredit: true,
      gasPrice: 3.49,
    });

    const ca = lookupZipRates("90210", 3.35);
    expect(ca?.state).toBe("CA");
    expect(ca?.tradeTaxCredit).toBe(false);
    expect(ca?.gasPrice).toBeGreaterThan(ny!.gasPrice);
  });

  it("evaluates LTV percentage over book value and approval tiers", async () => {
    const { evaluateLtv } = await import("./deal-math");
    const under = evaluateLtv(21000, 24000);
    expect(under.status).toBe("strong");
    expect(under.ltvPct).toBe(87.5);
    expect(under.overBookPct).toBe(-12.5);
    expect(under.cashNeededFor120Cap).toBe(0);

    const standard = evaluateLtv(26400, 24000);
    expect(standard.status).toBe("good");
    expect(standard.ltvPct).toBe(110);
    expect(standard.overBookPct).toBe(10);

    const stretch = evaluateLtv(28800, 24000);
    expect(stretch.status).toBe("stretch");
    expect(stretch.ltvPct).toBe(120);

    const overCap = evaluateLtv(31200, 24000);
    expect(overCap.status).toBe("over");
    expect(overCap.ltvPct).toBe(130);
    expect(overCap.cashNeededFor120Cap).toBe(2400);
  });
});
