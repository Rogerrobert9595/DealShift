// Encodes a customer-safe deal snapshot into a URL so the summary page needs no backend.
// Only deal inputs go in the link — never lot days, location or the talk track.
import { z } from "zod";

import type { CurrentInputs, DealInputs } from "./deal-math";

const n = z.number().finite();

const schema = z.object({
  v: z.literal(1),
  title: z.string().max(160),
  startMiles: n,
  modelYear: z.number().int().min(1950).max(2100).optional(),
  deal: z.object({
    price: n,
    cash: n,
    tradeValue: n,
    tradePayoff: n,
    taxRate: n,
    tradeTaxCredit: z.boolean(),
    fees: n,
    apr: n,
    term: z.number().int().min(1).max(120),
    mpg: n,
    maint: n,
  }),
  current: z.object({
    commute: n,
    currPay: n,
    currMpg: n,
    currMaint: n,
    gasPrice: n,
    insDelta: n,
  }),
});

export interface SummaryPayload {
  title: string;
  startMiles: number;
  modelYear?: number | undefined;
  deal: DealInputs;
  current: CurrentInputs;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSummary(p: SummaryPayload): string {
  return toBase64Url(JSON.stringify({ v: 1, ...p }));
}

export function decodeSummary(code: string): SummaryPayload | null {
  if (!code || code.length > 4000) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(fromBase64Url(code)));
    if (!parsed.success) return null;
    const { v: _v, ...rest } = parsed.data;
    return rest;
  } catch {
    return null;
  }
}
