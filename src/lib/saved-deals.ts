// Salesperson's saved customers + deal structures, stored per account in Cloudflare D1.
import { z } from "zod";

import type { CurrentInputs, DealInputs } from "./deal-math";
import {
  deleteSavedDealFn,
  getAccountScriptUrlFn,
  listSavedDealsFn,
  saveAccountScriptUrlFn,
  upsertSavedDealFn,
} from "./deals.functions";
import type { Vehicle } from "./inventory";

export interface TradeCar {
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  label: string | null;
  miles: number | null;
}

export interface SavedDeal {
  id: string;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  proposedStock: string | null;
  vehicle: Vehicle | null;
  tradeCar: TradeCar | null;
  deal: DealInputs | null;
  current: CurrentInputs | null;
  updatedAt: string;
}

const num = z.number().finite();

const dealSchema = z.object({
  price: num,
  cash: num,
  tradeValue: num.default(0),
  tradePayoff: num.default(0),
  taxRate: num.default(0),
  tradeTaxCredit: z.boolean().default(true),
  fees: num.default(0),
  apr: num,
  term: z.number().int().min(1).max(120),
  mpg: num,
  maint: num,
  insDelta: num.default(0),
  gasPrice: num.default(3.45),
});

const tradeSchema = z.object({
  vin: z.string().nullable().default(null),
  year: z.number().nullable().default(null),
  make: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  miles: z.number().nullable().default(null),
  currPay: num,
  currMpg: num,
  currMaint: num,
  commute: num,
});

const vehicleSchema = z
  .object({
    stock: z.string(),
    year: z.number(),
    makeModel: z.string(),
    price: num,
    miles: num,
  })
  .passthrough();

type Row = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  notes: string | null;
  proposed_stock: string | null;
  proposed_vehicle_json: unknown;
  trade_vehicle_json: unknown;
  deal_structure_json: unknown;
  updated_at: string;
};

function parseJsonColumn(val: unknown): unknown {
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** Turns a stored row back into desk state; bad or missing JSON pieces come back as null. */
export function parseDealRow(row: Row): SavedDeal {
  const d = dealSchema.safeParse(parseJsonColumn(row.deal_structure_json));
  const t = tradeSchema.safeParse(parseJsonColumn(row.trade_vehicle_json));
  const v = vehicleSchema.safeParse(parseJsonColumn(row.proposed_vehicle_json));
  let deal: DealInputs | null = null;
  let current: CurrentInputs | null = null;
  if (d.success) {
    const { insDelta: _i, gasPrice: _g, ...rest } = d.data;
    deal = rest;
  }
  if (d.success && t.success) {
    current = {
      commute: t.data.commute,
      currPay: t.data.currPay,
      currMpg: t.data.currMpg,
      currMaint: t.data.currMaint,
      gasPrice: d.data.gasPrice,
      insDelta: d.data.insDelta,
    };
  }
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes,
    proposedStock: row.proposed_stock,
    vehicle: v.success ? (v.data as unknown as Vehicle) : null,
    tradeCar: t.success
      ? { vin: t.data.vin, year: t.data.year, make: t.data.make, model: t.data.model, label: t.data.label, miles: t.data.miles }
      : null,
    deal,
    current,
    updatedAt: row.updated_at,
  };
}

export interface DealDraft {
  customerName: string;
  customerPhone: string;
  notes: string;
  vehicle: Vehicle;
  tradeCar: TradeCar | null;
  deal: DealInputs;
  current: CurrentInputs;
}

export function buildDealRow(d: DealDraft) {
  return {
    customer_name: d.customerName.trim(),
    customer_phone: d.customerPhone.trim() || null,
    notes: d.notes.trim() || null,
    proposed_stock: d.vehicle.stock,
    proposed_vehicle_json: d.vehicle,
    trade_vehicle_json: {
      ...(d.tradeCar ?? { vin: null, year: null, make: null, model: null, label: null, miles: null }),
      currPay: d.current.currPay,
      currMpg: d.current.currMpg,
      currMaint: d.current.currMaint,
      commute: d.current.commute,
    },
    deal_structure_json: { ...d.deal, insDelta: d.current.insDelta, gasPrice: d.current.gasPrice },
  };
}

export async function listSavedDeals(): Promise<SavedDeal[]> {
  const rows = await listSavedDealsFn();
  return (rows ?? []).map(parseDealRow);
}

/** Inserts a new deal, or updates the one with `id`. Returns the saved row. */
export async function saveDeal(draft: DealDraft, id?: string): Promise<SavedDeal> {
  const row = buildDealRow(draft);
  const saved = await upsertSavedDealFn({ data: id ? { ...row, id } : row });
  return parseDealRow(saved);
}

export async function deleteDeal(id: string) {
  await deleteSavedDealFn({ data: { id } });
}

export async function getAccountScriptUrl(): Promise<string | null> {
  const res = await getAccountScriptUrlFn();
  return res?.url ?? null;
}

export async function saveAccountScriptUrl(_userId: string, url: string) {
  await saveAccountScriptUrlFn({ data: { url } });
}
