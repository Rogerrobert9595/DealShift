import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { StoredDealRow } from "./cloudflare.server";

export type { StoredDealRow };

const dealPayloadSchema = z.object({
  id: z.string().max(128).optional(),
  customer_name: z.string().trim().min(1).max(200),
  customer_phone: z.string().max(60).nullable(),
  notes: z.string().max(2000).nullable(),
  proposed_stock: z.string().max(80).nullable(),
  proposed_vehicle_json: z.unknown(),
  trade_vehicle_json: z.unknown(),
  deal_structure_json: z.unknown(),
});

export const listSavedDealsFn = createServerFn({ method: "POST" }).handler(async (): Promise<StoredDealRow[]> => {
  const { getD1, getMemoryStore, requireSessionUser } = await import("./cloudflare.server");
  const user = await requireSessionUser();
  const db = await getD1();

  if (db) {
    const res = await db
      .prepare(
        `SELECT id, user_id, customer_name, customer_phone, notes, proposed_stock,
                proposed_vehicle_json, trade_vehicle_json, deal_structure_json, created_at, updated_at
         FROM saved_deals
         WHERE user_id = ?1
         ORDER BY updated_at DESC
         LIMIT 500`,
      )
      .bind(user.id)
      .all<StoredDealRow>();
    return res.results ?? [];
  }

  const mem = getMemoryStore();
  return Array.from(mem.deals.values())
    .filter((r) => r.user_id === user.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 500);
});

export const upsertSavedDealFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => dealPayloadSchema.parse(data))
  .handler(async ({ data }): Promise<StoredDealRow> => {
    const { getD1, getMemoryStore, requireSessionUser } = await import("./cloudflare.server");
    const user = await requireSessionUser();
    const db = await getD1();
    const now = new Date().toISOString();

    const proposedJson = data.proposed_vehicle_json != null ? JSON.stringify(data.proposed_vehicle_json) : null;
    const tradeJson = data.trade_vehicle_json != null ? JSON.stringify(data.trade_vehicle_json) : null;
    const structureJson = data.deal_structure_json != null ? JSON.stringify(data.deal_structure_json) : null;

    if (db) {
      if (data.id) {
        await db
          .prepare(
            `UPDATE saved_deals
             SET customer_name = ?1,
                 customer_phone = ?2,
                 notes = ?3,
                 proposed_stock = ?4,
                 proposed_vehicle_json = ?5,
                 trade_vehicle_json = ?6,
                 deal_structure_json = ?7,
                 updated_at = ?8
             WHERE id = ?9 AND user_id = ?10`,
          )
          .bind(
            data.customer_name,
            data.customer_phone,
            data.notes,
            data.proposed_stock,
            proposedJson,
            tradeJson,
            structureJson,
            now,
            data.id,
            user.id,
          )
          .run();

        const updated = await db
          .prepare(
            `SELECT id, user_id, customer_name, customer_phone, notes, proposed_stock,
                    proposed_vehicle_json, trade_vehicle_json, deal_structure_json, created_at, updated_at
             FROM saved_deals
             WHERE id = ?1 AND user_id = ?2`,
          )
          .bind(data.id, user.id)
          .first<StoredDealRow>();
        if (updated) return updated;
      }

      const id = data.id ?? crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO saved_deals (
            id, user_id, customer_name, customer_phone, notes, proposed_stock,
            proposed_vehicle_json, trade_vehicle_json, deal_structure_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          id,
          user.id,
          data.customer_name,
          data.customer_phone,
          data.notes,
          data.proposed_stock,
          proposedJson,
          tradeJson,
          structureJson,
          now,
          now,
        )
        .run();

      return {
        id,
        user_id: user.id,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        notes: data.notes,
        proposed_stock: data.proposed_stock,
        proposed_vehicle_json: proposedJson,
        trade_vehicle_json: tradeJson,
        deal_structure_json: structureJson,
        created_at: now,
        updated_at: now,
      };
    }

    const mem = getMemoryStore();
    const existing = data.id ? mem.deals.get(data.id) : undefined;
    const id = existing && existing.user_id === user.id ? existing.id : crypto.randomUUID();
    const row: StoredDealRow = {
      id,
      user_id: user.id,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      notes: data.notes,
      proposed_stock: data.proposed_stock,
      proposed_vehicle_json: proposedJson,
      trade_vehicle_json: tradeJson,
      deal_structure_json: structureJson,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    mem.deals.set(id, row);
    return row;
  });

export const deleteSavedDealFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().min(1).max(128) }).parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { getD1, getMemoryStore, requireSessionUser } = await import("./cloudflare.server");
    const user = await requireSessionUser();
    const db = await getD1();

    if (db) {
      await db.prepare("DELETE FROM saved_deals WHERE id = ?1 AND user_id = ?2").bind(data.id, user.id).run();
    } else {
      const mem = getMemoryStore();
      const row = mem.deals.get(data.id);
      if (row?.user_id === user.id) mem.deals.delete(data.id);
    }
    return { ok: true };
  });

export const getAccountScriptUrlFn = createServerFn({ method: "POST" }).handler(async (): Promise<{ url: string | null }> => {
  const { getD1, getMemoryStore, getSessionUser } = await import("./cloudflare.server");
  const user = await getSessionUser();
  if (!user) return { url: null };
  const db = await getD1();

  if (db) {
    const row = await db
      .prepare("SELECT inventory_script_url FROM user_settings WHERE user_id = ?1")
      .bind(user.id)
      .first<{ inventory_script_url: string | null }>();
    return { url: row?.inventory_script_url?.trim() || null };
  }

  const mem = getMemoryStore();
  return { url: mem.settings.get(user.id)?.inventory_script_url?.trim() || null };
});

export const saveAccountScriptUrlFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ url: z.string().max(500) }).parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { getD1, getMemoryStore, requireSessionUser } = await import("./cloudflare.server");
    const user = await requireSessionUser();
    const db = await getD1();
    const cleanUrl = data.url.trim() || null;
    const now = new Date().toISOString();

    if (db) {
      await db
        .prepare(
          `INSERT INTO user_settings (user_id, inventory_script_url, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(user_id) DO UPDATE SET
             inventory_script_url = excluded.inventory_script_url,
             updated_at = excluded.updated_at`,
        )
        .bind(user.id, cleanUrl, now)
        .run();
    } else {
      const mem = getMemoryStore();
      mem.settings.set(user.id, { user_id: user.id, inventory_script_url: cleanUrl, updated_at: now });
    }
    return { ok: true };
  });
