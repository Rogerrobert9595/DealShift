import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, ExternalLink, Loader2, ShieldAlert, Wrench } from "lucide-react";

import { AAA_MAINT_CENTS_PER_MILE, AAA_SOURCE_URL, aaaMonthlyMaint, serviceWindow } from "@/lib/deal-math";
import { vehicleLookupCache } from "@/lib/lookup-cache";
import { getSafetyRecords, type SafetyRecords } from "@/lib/vehicle.functions";

interface Props {
  year: number | null;
  make: string;
  model: string;
  vin: string | null;
  odometer: number | null;
  milesPerYear: number;
  mpgSource: "epa" | "estimate" | null;
}

/** Third-party sources behind the current-car numbers, so they read as facts, not a pitch. */
export function CarSources({ year, make, model, vin, odometer, milesPerYear, mpgSource }: Props) {
  const [safety, setSafety] = useState<SafetyRecords | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchSafety = useServerFn(getSafetyRecords);

  useEffect(() => {
    if (!year || !make || !model) return;
    let cancelled = false;
    setLoading(true);
    setSafety(null);
    vehicleLookupCache
      .get(
        `safety:${year}:${make}:${model}`,
        () => fetchSafety({ data: { year, make, model } }),
        (r) => !r.error,
      )
      .then((r) => !cancelled && setSafety(r))
      .catch(() => !cancelled && setSafety({ recalls: 0, complaints: 0, topComplaints: [], error: "NHTSA didn't respond." }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, make, model]);

  const win = odometer != null ? serviceWindow(odometer) : null;
  const recallUrl = vin && vin.length === 17 ? `https://www.nhtsa.gov/recalls?vin=${vin}` : "https://www.nhtsa.gov/recalls";

  return (
    <div className="space-y-2 text-xs">
      {win && (win.passed || win.next) && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background/50 p-2.5">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-maint" />
          <div className="min-w-0 space-y-0.5">
            {win.passed && (
              <div>
                <span className="font-medium text-foreground">Past the {win.passed.label}:</span>{" "}
                <span className="text-muted-foreground">{win.passed.items}</span>
              </div>
            )}
            {win.next && (
              <div>
                <span className="font-medium text-foreground">Next up, {win.next.label}:</span>{" "}
                <span className="text-muted-foreground">{win.next.items}</span>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">Typical manufacturer service schedule</div>
          </div>
        </div>
      )}

      {year && make && model && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background/50 p-2.5">
          {loading ? (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cost" />
          )}
          <div className="min-w-0">
            {loading ? (
              <span className="text-muted-foreground">Checking NHTSA recalls and complaints…</span>
            ) : safety?.error ? (
              <span className="text-muted-foreground">Couldn't reach NHTSA right now.</span>
            ) : safety ? (
              <>
                <div className="text-foreground">
                  <span className="num font-semibold">{safety.recalls}</span> safety recall{safety.recalls === 1 ? "" : "s"} ·{" "}
                  <span className="num font-semibold">{safety.complaints.toLocaleString("en-US")}</span> owner complaint
                  {safety.complaints === 1 ? "" : "s"} for the {year} {model}
                </div>
                {safety.topComplaints.length > 0 && (
                  <div className="truncate text-muted-foreground">Most reported: {safety.topComplaints.join(", ")}</div>
                )}
                <a href={recallUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline">
                  Source: NHTSA{vin && vin.length === 17 ? " · check this VIN for open recalls" : ""} <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <SourceBadge>Repairs: brand repair averages × mileage</SourceBadge>
        <SourceBadge href={AAA_SOURCE_URL}>
          AAA 2025 new-car avg {AAA_MAINT_CENTS_PER_MILE}¢/mi ≈ ${aaaMonthlyMaint(milesPerYear)}/mo at their driving
        </SourceBadge>
        {mpgSource && (
          <SourceBadge href="https://www.fueleconomy.gov">
            MPG: {mpgSource === "epa" ? "EPA fueleconomy.gov" : "estimated from engine (NHTSA VIN data)"}
          </SourceBadge>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ children, href }: { children: React.ReactNode; href?: string }) {
  const cls = "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground";
  const body = (
    <>
      <BadgeCheck className="h-3 w-3 shrink-0 text-primary" />
      <span>{children}</span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}
