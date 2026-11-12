import { describe, expect, it, vi } from "vitest";

import { hashPassword, verifyPassword } from "./cloudflare.server";
import { monthlyCashFlowDelta, quickDeal, simulate, type CurrentInputs, type DealInputs } from "./deal-math";
import { isVin, normalizeSheetJson, parsePastedRows, VIN_RE, SAMPLE_INVENTORY } from "./inventory";
import { createLookupCache } from "./lookup-cache";
import { buildDealRow, parseDealRow } from "./saved-deals";

const deal: DealInputs = {
  price: 23999,
  cash: 2500,
  tradeValue: 4000,
  tradePayoff: 1500,
  taxRate: 8,
  tradeTaxCredit: true,
  fees: 375,
  apr: 6.9,
  term: 72,
  mpg: 27,
  maint: 58,
};
const current: CurrentInputs = { commute: 42, currPay: 310, currMpg: 18, currMaint: 165, gasPrice: 3.45, insDelta: 18 };

describe("quickDeal (term cards / $1,000 more down)", () => {
  it.each([48, 60, 72, 84])("matches the full simulation's payment and equity month at %i months", (term) => {
    const full = simulate({ ...deal, term }, current, 11604);
    const quick = quickDeal({ ...deal, term }, full.annualMiles);
    expect(quick.payment).toBeCloseTo(full.payment, 6);
    expect(quick.breakevenMonth).toBe(full.breakevenMonth);
  });

  it("matches with $1,000 more down and a heavy 100 mi/day driver", () => {
    const heavy = { ...current, commute: 100 };
    const full = simulate({ ...deal, cash: deal.cash + 1000 }, heavy, 11604);
    const quick = quickDeal({ ...deal, cash: deal.cash + 1000 }, full.annualMiles);
    expect(quick.payment).toBeCloseTo(full.payment, 6);
    expect(quick.breakevenMonth).toBe(full.breakevenMonth);
  });

  it("agrees on a late crossover when negative equity is rolled in", () => {
    const upside = { ...deal, cash: 0, tradeValue: 0, tradePayoff: 8000, apr: 18.9, term: 84 };
    const full = simulate(upside, { ...current, commute: 110 }, 0);
    expect(full.breakevenMonth).toBeGreaterThan(60);
    expect(quickDeal(upside, full.annualMiles).breakevenMonth).toBe(full.breakevenMonth);
  });

  it("computes monthlyCashFlowDelta identical to simulate().trueDelta", () => {
    const full = simulate(deal, current, 11604);
    expect(monthlyCashFlowDelta(deal, current)).toBeCloseTo(full.trueDelta, 10);
  });
});

describe("VIN check", () => {
  it("accepts a 17-character VIN and rejects I, O and Q", () => {
    expect(VIN_RE.test("KL4AMCSL0TB008832")).toBe(true);
    expect(isVin(" kl4amcsl0tb008832 ")).toBe(true);
    expect(isVin("KL4AMCSL0TB00883I")).toBe(false);
    expect(isVin("SHORT")).toBe(false);
    expect(isVin("")).toBe(false);
  });
});

describe("sheet engine spec", () => {
  it("reads engineSpec from the Apps Script feed", () => {
    const [v] = normalizeSheetJson({
      vehicles: [{ stock: "2-48134", year: 2026, makeModel: "Buick Encore GX", price: 23999, engineSpec: "1.3L 3-Cyl (Gasoline)" }],
    });
    expect(v?.engine).toBe("1.3L 3-Cyl (Gasoline)");
  });

  it("leaves engine empty when the sheet has no spec", () => {
    const [v] = normalizeSheetJson({ vehicles: [{ stock: "1", year: 2024, makeModel: "Toyota RAV4", price: 29450, engineSpec: "" }] });
    expect(v?.engine).toBeNull();
  });

  it("skips sheet vehicles with missing or zero price", () => {
    const list = normalizeSheetJson({
      vehicles: [
        { stock: "1", year: 2024, makeModel: "Toyota RAV4", price: 0 },
        { stock: "2", year: 2024, makeModel: "Honda Civic", price: 22750 },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.stock).toBe("2");
  });

  it("reads the engine column from pasted rows", () => {
    const row = ["S", "2-48134", "2026", "Buick Encore GX", "AWD", "11,604", "$23,999", "39", "S", "KL4AMCSL0TB008832", "", "27", "58", "1.3L 3-Cyl (Gasoline)"].join("\t");
    expect(parsePastedRows(row)[0]?.engine).toBe("1.3L 3-Cyl (Gasoline)");
  });

  it("rejects out-of-range MPG (like shifted odometer values) and strips trailing commas from makeModel/desc", () => {
    const [v] = normalizeSheetJson({
      vehicles: [
        {
          stock: "9-16469DR",
          year: 2024,
          makeModel: "Chevrolet Blazer,",
          desc: "Turbo I-4 2.5L, ",
          price: 27599,
          epaMpg: 49808,
          estMaint: 12000,
        },
      ],
    });
    expect(v?.makeModel).toBe("Chevrolet Blazer");
    expect(v?.desc).toBe("Turbo I-4 2.5L");
    expect(v?.epaMpg).toBeNull();
    expect(v?.estMaint).toBeNull();
  });
});

describe("lookup cache", () => {
  it("calls the network once for repeat lookups of the same car", async () => {
    const cache = createLookupCache();
    const load = vi.fn(async () => ({ combMpg: 27 }));
    await cache.get("vin:KL4", load);
    await cache.get("vin:KL4", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a lookup that failed or came back empty", async () => {
    const cache = createLookupCache();
    const fail = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(cache.get("a", fail)).rejects.toThrow("offline");
    const empty = vi.fn(async () => ({ source: "none" }));
    await cache.get("a", empty, (r) => r.source !== "none");
    await cache.get("a", empty, (r) => r.source !== "none");
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it("drops the oldest entries past its size limit", async () => {
    const cache = createLookupCache(2);
    await cache.get("1", async () => 1);
    await cache.get("2", async () => 2);
    await cache.get("3", async () => 3);
    expect(cache.has("1")).toBe(false);
    expect(cache.size).toBe(2);
  });
});

describe("Cloudflare D1 saved deal serialization & password hashing", () => {
  it("parses both JSON strings (D1 TEXT columns) and raw objects in parseDealRow", () => {
    const built = buildDealRow({
      customerName: "  Jane Doe  ",
      customerPhone: " 555-0199 ",
      notes: " Ready to buy ",
      vehicle: SAMPLE_INVENTORY[0]!,
      tradeCar: { vin: null, year: 2019, make: "Ford", model: "Escape", label: "2019 Ford Escape", miles: 68000 },
      deal,
      current,
    });
    const parsedFromStrings = parseDealRow({
      id: "deal-1",
      customer_name: built.customer_name,
      customer_phone: built.customer_phone,
      notes: built.notes,
      proposed_stock: built.proposed_stock,
      proposed_vehicle_json: JSON.stringify(built.proposed_vehicle_json),
      trade_vehicle_json: JSON.stringify(built.trade_vehicle_json),
      deal_structure_json: JSON.stringify(built.deal_structure_json),
      updated_at: "2026-04-01T00:00:00.000Z",
    });

    expect(parsedFromStrings.customerName).toBe("Jane Doe");
    expect(parsedFromStrings.customerPhone).toBe("555-0199");
    expect(parsedFromStrings.deal).toEqual(deal);
    expect(parsedFromStrings.current).toEqual(current);
    expect(parsedFromStrings.vehicle?.stock).toBe(SAMPLE_INVENTORY[0]!.stock);
  });

  it("hashes and verifies passwords with Web Crypto PBKDF2", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash.startsWith("pbkdf2:")).toBe(true);
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});
