import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ClipboardPaste, Loader2, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { saveAccountScriptUrl } from "@/lib/saved-deals";
import { parsePastedRows, SAMPLE_INVENTORY, type Vehicle } from "@/lib/inventory";
import { DEFAULT_SCRIPT_URL, getSheetUrl, saveSheetUrl } from "@/lib/sheet-config";
import { cn } from "@/lib/utils";
import { fetchSheetInventory } from "@/lib/vehicle.functions";

import { money, num } from "./fields";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: Vehicle[];
  source: string;
  selectedStock: string;
  sheetError: string | null;
  onSelect: (v: Vehicle) => void;
  onReplace: (list: Vehicle[], source: string) => void;
}

export function InventoryPanel({ open, onOpenChange, inventory, source, selectedStock, sheetError, onSelect, onReplace }: Props) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState("");
  // Saved link on this device, else the built-in default (synced on mount/open to avoid SSR hydration mismatch).
  const [url, setUrl] = useState(DEFAULT_SCRIPT_URL);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [paste, setPaste] = useState("");
  const sync = useServerFn(fetchSheetInventory);
  const { user } = useAuth();

  // Read saved link on mount and whenever the panel opens (an account sign-in may have swapped the saved link).
  useEffect(() => {
    setUrl(getSheetUrl());
  }, [open]);

  useEffect(() => {
    setSyncError(sheetError);
  }, [sheetError]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter((v) =>
      [v.stock, v.makeModel, v.desc, String(v.year), v.vin, v.loc].join(" ").toLowerCase().includes(q),
    );
  }, [filter, inventory]);

  const runSync = async (save: boolean) => {
    const link = url.trim();
    if (save) {
      saveSheetUrl(link);
      setJustSaved(true);
      toast.success(user ? "Saved to your account! Syncing inventory…" : "Saved! Syncing inventory…");
      if (user) {
        saveAccountScriptUrl(user.id, link).catch(() => toast.error("Saved on this phone, but not to your account."));
      }
    }
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await sync({ data: { url: link } });
      if (res.error) {
        setSyncError(res.error);
      } else {
        onReplace(res.vehicles, `Sheet: ${res.tabName ?? "live"}`);
        toast.success(`Loaded ${res.vehicles.length} units from your sheet`);
      }
    } catch {
      setSyncError("That doesn't look like a valid link.");
    } finally {
      setSyncing(false);
    }
  };

  const importPaste = (mode: "replace" | "add") => {
    const rows = parsePastedRows(paste);
    if (!rows.length) {
      toast.error("No vehicles found. Copy whole rows from the sheet, including Stock, Year, Model and Price.");
      return;
    }
    const rowStocks = new Set(rows.map((r) => r.stock));
    const merged =
      mode === "replace"
        ? rows
        : [...rows, ...inventory.filter((v) => !rowStocks.has(v.stock))];
    onReplace(merged, mode === "replace" ? "Pasted rows" : source);
    setPaste("");
    toast.success(`${mode === "replace" ? "Loaded" : "Added"} ${rows.length} units`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-0 p-0", isMobile ? "h-[88dvh] rounded-t-3xl" : "w-full sm:max-w-md")}
      >
        <SheetHeader className="border-b border-border px-5 pb-3 pt-5 text-left">
          <SheetTitle>Inventory</SheetTitle>
          <SheetDescription>
            {inventory.length} units · {source}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="units" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-3 grid grid-cols-3">
            <TabsTrigger value="units">Units</TabsTrigger>
            <TabsTrigger value="sheet">Sheet link</TabsTrigger>
            <TabsTrigger value="paste">Paste rows</TabsTrigger>
          </TabsList>

          <TabsContent value="units" className="mt-0 flex min-h-0 flex-1 flex-col">
            <div className="relative px-5 py-3">
              <Search className="pointer-events-none absolute left-8 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by stock, model, year, VIN"
                className="h-11 pl-9 text-base"
              />
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              {filtered.map((v) => (
                <li key={v.stock}>
                  <button
                    onClick={() => {
                      onSelect(v);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors active:bg-accent",
                      v.stock === selectedStock ? "border-primary bg-primary/10" : "border-border bg-background/40",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="num text-xs text-primary">#{v.stock}</div>
                      <div className="truncate font-medium">
                        {v.year} {v.makeModel}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {v.desc} · {num(v.miles)} mi · {v.days}d · {v.loc}
                      </div>
                    </div>
                    <div className="num text-right font-semibold">{money(v.price)}</div>
                  </button>
                </li>
              ))}
              {!filtered.length && <li className="py-8 text-center text-sm text-muted-foreground">No matches.</li>}
            </ul>
          </TabsContent>

          <TabsContent value="sheet" className="mt-0 space-y-4 overflow-y-auto px-5 py-4">
            <p className="text-sm text-muted-foreground">
              The app loads your sheet from this link by itself every time it opens. The script must be deployed as a web app with
              <b className="text-foreground"> Execute as: Me</b> and <b className="text-foreground">Who has access: Anyone</b>. Paste a new link and tap
              <b className="text-foreground"> Save URL</b> only if you made a brand-new deployment — this phone remembers it.
            </p>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="num h-11 min-w-0 flex-1 text-sm"
                placeholder="https://script.google.com/macros/s/…/exec"
                aria-label="Apps Script link"
              />
              <Button onClick={() => void runSync(true)} disabled={syncing || !url.trim()} className="h-11 shrink-0">
                {justSaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {justSaved ? "Saved!" : "Save URL"}
              </Button>
            </div>
            {url.trim().endsWith("/dev") && (
              <p className="text-xs text-cost">Links ending in /dev only work for you while signed in to Google. Use the /exec link.</p>
            )}
            <Button variant="secondary" onClick={() => void runSync(false)} disabled={syncing || !url.trim()} className="h-11 w-full">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync now
            </Button>
            {syncError && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{syncError}</p>}
            {url.trim() !== DEFAULT_SCRIPT_URL && (
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setUrl(DEFAULT_SCRIPT_URL)}>
                <RotateCcw className="h-4 w-4" /> Use the built-in link
              </Button>
            )}
          </TabsContent>

          <TabsContent value="paste" className="mt-0 space-y-3 overflow-y-auto px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Select rows in your inventory sheet, copy, and paste here. Columns: Loc, Stock, Year, Model, Desc, Miles, Price, Days, Status, VIN (MPG and Maint optional).
            </p>
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={7}
              className="num text-xs"
              placeholder={"S\t2-48134\t2026\tBuick Encore GX\tAWD Preferred\t11,604\t$23,999\t39\tS\tKL4AMCSL0TB008832"}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-11" onClick={() => importPaste("add")} disabled={!paste.trim()}>
                <ClipboardPaste className="h-4 w-4" /> Add
              </Button>
              <Button className="h-11" onClick={() => importPaste("replace")} disabled={!paste.trim()}>
                Replace all
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => {
                onReplace(SAMPLE_INVENTORY, "Sample units");
                toast("Back to sample units");
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset to sample units
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
