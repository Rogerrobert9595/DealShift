// Inventory types, sample units, and parsers for pasted sheet rows / sheet JSON.

/** 11–17 character VIN (letters I, O and Q are never used). Shared by every VIN check. */
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{11,17}$/i;
export const isVin = (v: string | null | undefined): v is string => !!v && VIN_RE.test(v.trim());

export interface Vehicle {
  stock: string;
  loc: string;
  year: number;
  makeModel: string;
  desc: string;
  miles: number;
  price: number;
  days: number;
  stat: string;
  vin: string;
  epaMpg: number | null;
  estMaint: number | null;
  cityMpg?: number | null;
  hwyMpg?: number | null;
  engine?: string | null;
}

// Sample units so the desk works before a sheet is connected.
export const SAMPLE_INVENTORY: Vehicle[] = [
  { stock: "2-48134", loc: "S", year: 2026, makeModel: "Buick Encore GX", desc: "AWD Preferred", miles: 11604, price: 23999, days: 39, stat: "S", vin: "KL4AMCSL0TB008832", epaMpg: 27, estMaint: 58, cityMpg: 26, hwyMpg: 28, engine: "Gas 1.3L" },
  { stock: "1-78825NA", loc: "N", year: 2024, makeModel: "Toyota RAV4", desc: "XLE AWD", miles: 28410, price: 29450, days: 18, stat: "S", vin: "", epaMpg: 30, estMaint: 47, cityMpg: 27, hwyMpg: 34, engine: "Gas 2.5L 4-Cyl" },
  { stock: "2-47990", loc: "S", year: 2023, makeModel: "Chevrolet Equinox", desc: "LT FWD", miles: 34122, price: 21995, days: 52, stat: "S", vin: "", epaMpg: 28, estMaint: 71, cityMpg: 26, hwyMpg: 31, engine: "Gas 1.5L Turbo" },
  { stock: "1-78702", loc: "N", year: 2022, makeModel: "Honda Civic", desc: "Sport Sedan", miles: 41250, price: 22750, days: 11, stat: "S", vin: "", epaMpg: 33, estMaint: 51, cityMpg: 30, hwyMpg: 37, engine: "Gas 2.0L 4-Cyl" },
  { stock: "2-48201", loc: "S", year: 2025, makeModel: "Hyundai Tucson", desc: "SEL AWD", miles: 9875, price: 27380, days: 7, stat: "S", vin: "", epaMpg: 28, estMaint: 47, cityMpg: 25, hwyMpg: 32, engine: "Gas 2.5L 4-Cyl" },
  { stock: "1-78611", loc: "N", year: 2021, makeModel: "Ford F-150", desc: "XLT SuperCrew 4x4", miles: 58930, price: 33995, days: 64, stat: "S", vin: "", epaMpg: 20, estMaint: 82, cityMpg: 18, hwyMpg: 24, engine: "Gas 3.5L V6 Turbo" },
  { stock: "2-48077", loc: "S", year: 2024, makeModel: "Kia Sportage", desc: "EX AWD", miles: 19340, price: 25490, days: 23, stat: "S", vin: "", epaMpg: 27, estMaint: 52, cityMpg: 25, hwyMpg: 30, engine: "Gas 2.5L 4-Cyl" },
  { stock: "1-78890", loc: "N", year: 2023, makeModel: "Jeep Grand Cherokee", desc: "Limited 4x4", miles: 30215, price: 34850, days: 31, stat: "S", vin: "", epaMpg: 21, estMaint: 81, cityMpg: 19, hwyMpg: 26, engine: "Gas 3.6L V6" },
];

const toInt = (v: unknown) => parseInt(String(v ?? "").replace(/[$,\s]/g, ""), 10);
const toNum = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toMpg = (v: unknown) => {
  const n = toNum(v);
  return n !== null && n >= 5 && n <= 150 ? n : null;
};
const toMaint = (v: unknown) => {
  const n = toNum(v);
  return n !== null && n >= 10 && n <= 500 ? n : null;
};
const cleanLabel = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s*,\s*,+/g, ", ");
const toText = (v: unknown) => {
  const t = cleanLabel(v);
  return t ? t.slice(0, 80) : null;
};
const isYear = (v: unknown) => {
  const n = toInt(v);
  return /^\s*\d{4}\s*$/.test(String(v ?? "")) && n >= 1980 && n <= 2035;
};

/**
 * Parse rows copied from the inventory sheet (tab separated).
 * Finds the year column on each row so it works whether the copy starts at column A, B or C.
 * Layout from the stock column: Stock, Year, Model, Desc, Miles, Price, Days, Status, VIN, (skip), MPG, Maint, Engine spec.
 */
export function parsePastedRows(text: string): Vehicle[] {
  const out: Vehicle[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const clean = cells.map((c) => c.replace(/^"|"$/g, "").trim());
    const yearIdx = clean.findIndex((c, i) => i > 0 && isYear(c) && clean[i - 1] !== "");
    if (yearIdx < 1) continue;
    const s = yearIdx - 1;
    const stock = clean[s];
    const model = cleanLabel(clean[s + 2]);
    const price = toInt(clean[s + 5]) || 0;
    if (!stock || stock.toLowerCase() === "stock" || !model || price <= 0) continue;
    out.push({
      stock,
      loc: (s > 0 ? clean[s - 1] : "") || "LOT",
      year: toInt(clean[s + 1]),
      makeModel: model,
      desc: cleanLabel(clean[s + 3]),
      miles: toInt(clean[s + 4]) || 0,
      price,
      days: toInt(clean[s + 6]) || 0,
      stat: clean[s + 7] || "S",
      vin: clean[s + 8] ?? "",
      epaMpg: toMpg(clean[s + 10]),
      estMaint: toMaint(clean[s + 11]),
      engine: toText(clean[s + 12]),
    });
  }
  return out;
}

/** Normalise the JSON served by the Apps Script doGet endpoint. */
interface RawUnit {
  stock?: unknown;
  loc?: unknown;
  year?: unknown;
  makeModel?: unknown;
  model?: unknown;
  desc?: unknown;
  miles?: unknown;
  price?: unknown;
  days?: unknown;
  stat?: unknown;
  vin?: unknown;
  epaMpg?: unknown;
  estMaint?: unknown;
  engineSpec?: unknown; // column O "VIN Engine Spec", e.g. "1.3L 3-Cyl (Gasoline)"
  engine?: unknown;
}

export function normalizeSheetJson(json: unknown): Vehicle[] {
  const obj = (json ?? {}) as { vehicles?: unknown; units?: unknown };
  const list = (Array.isArray(json) ? json : (obj.vehicles ?? obj.units ?? [])) as RawUnit[];
  if (!Array.isArray(list)) return [];
  return list
    .map((u) => ({
      stock: String(u.stock ?? "").trim(),
      loc: String(u.loc ?? "LOT").trim() || "LOT",
      year: toInt(u.year),
      makeModel: cleanLabel(u.makeModel ?? u.model),
      desc: cleanLabel(u.desc),
      miles: toInt(u.miles) || 0,
      price: toInt(u.price) || 0,
      days: toInt(u.days) || 0,
      stat: String(u.stat ?? "S").trim(),
      vin: String(u.vin ?? "").trim(),
      epaMpg: toMpg(u.epaMpg),
      estMaint: toMaint(u.estMaint),
      engine: toText(u.engineSpec ?? u.engine),
    }))
    .filter((v) => v.stock && v.makeModel && !Number.isNaN(v.year) && v.price > 0);
}

export function findByStock(list: Vehicle[], query: string): Vehicle | undefined {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return undefined;
  return (
    list.find((v) => v.stock.toLowerCase() === q) ??
    list.find((v) => v.stock.toLowerCase().includes(q)) ??
    list.find((v) => v.vin.toLowerCase().endsWith(q))
  );
}
