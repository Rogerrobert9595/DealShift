import { useRef } from "react";

import type { SimPoint } from "@/lib/deal-math";

interface Props {
  series: SimPoint[];
  month: number;
  breakeven: number | null;
  onScrub?: (m: number) => void;
  /** A pinned deal to compare against, drawn as dashed lines. */
  pinned?: { series: SimPoint[]; breakeven: number | null } | null;
  /** Warranty cliff line and sweet-spot trade window (loan months). */
  milestones?: {
    warranty?: { month: number; label: string } | null;
    window?: { start: number; end: number } | null;
  };
  /** Shows a floating glass readout that follows the scrub handle. */
  tooltip?: { vehicle: string; odometer: number } | null;
}

const W = 600;
const H = 240;
const L = 46;
const R = 12;
const T = 12;
const B = 26;

export function EquityChart({ series, month, breakeven, onScrub, pinned, milestones, tooltip }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const ownTerm = Math.max(1, series.length - 1);
  const term = Math.max(ownTerm, pinned ? pinned.series.length - 1 : 0);
  const all = pinned ? [...series, ...pinned.series] : series;
  const maxY = Math.max(1, ...all.map((p) => Math.max(p.value, p.balance))) * 1.06;
  // Rounded so server and browser render identical coordinates.
  const x = (m: number) => Math.round((L + (m / term) * (W - L - R)) * 10) / 10;
  const y = (v: number) => Math.round((T + (1 - v / maxY) * (H - T - B)) * 10) / 10;
  const line = (s: SimPoint[], k: "value" | "balance") => s.map((p, i) => `${i ? "L" : "M"}${x(p.month)},${y(p[k])}`).join("");
  const valueArea = `${line(series, "value")}L${x(ownTerm)},${y(0)}L${x(0)},${y(0)}Z`;
  const p = series[Math.min(month, ownTerm)];

  const scrubFrom = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !onScrub) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    const m = Math.round(((px - L) / (W - L - R)) * term);
    onScrub(Math.min(ownTerm, Math.max(1, m)));
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => (maxY / 1.06) * f);
  const years = Array.from({ length: Math.floor(term / 12) }, (_, i) => (i + 1) * 12);
  const pb = pinned?.breakeven;
  const win = milestones?.window;
  const wc = milestones?.warranty && milestones.warranty.month <= ownTerm ? milestones.warranty : null;
  const wcRight = wc ? x(wc.month) > W - 110 : false;

  const tipLeft = p ? (x(p.month) / W) * 100 : 0;
  return (
    <div className="relative">
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={onScrub ? "h-auto w-full cursor-crosshair select-none" : "h-auto w-full select-none"}
      style={{ touchAction: "pan-y" }}
      role="img"
      aria-label="Vehicle value versus loan balance over the loan term"
      onPointerDown={(e) => {
        if (!onScrub) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubFrom(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && scrubFrom(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <defs>
        <linearGradient id="valueFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray={v ? "3 5" : undefined} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground num text-[11px]">
            ${Math.round(v / 1000)}k
          </text>
        </g>
      ))}
      {years.map((m) => (
        <text key={m} x={x(m)} y={H - 6} textAnchor="middle" className="fill-muted-foreground num text-[11px]">
          M{m}
        </text>
      ))}
      {years.map((m) => (
        <line key={`g${m}`} x1={x(m)} x2={x(m)} y1={T} y2={H - B} className="stroke-border" />
      ))}

      {win && (
        <g>
          <rect x={x(win.start)} y={T} width={Math.max(2, x(win.end) - x(win.start))} height={H - T - B} className="fill-gain/10" />
          <text x={(x(win.start) + x(win.end)) / 2} y={H - B - 6} textAnchor="middle" className="fill-gain text-[10px] font-semibold">
            Trade window
          </text>
        </g>
      )}
      {wc && (
        <g>
          <line x1={x(wc.month)} x2={x(wc.month)} y1={T} y2={H - B} className="stroke-loss" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={x(wc.month) + (wcRight ? -5 : 5)} y={T + 10} textAnchor={wcRight ? "end" : "start"} className="fill-loss text-[10px] font-semibold">
            {wc.label}
          </text>
        </g>
      )}

      {pinned && (
        <g className="text-muted-foreground">
          <path d={line(pinned.series, "balance")} className="fill-none stroke-current" strokeWidth={2} strokeDasharray="6 5" />
          {pb != null && pb >= 0 && pinned.series[pb] && (
            <circle cx={x(pb)} cy={y(pinned.series[pb].value)} r={4} className="fill-background stroke-current" strokeWidth={2} />
          )}
        </g>
      )}

      <path d={valueArea} className="text-gain" fill="url(#valueFill)" />
      <path d={line(series, "balance")} className="fill-none stroke-cost" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={line(series, "value")} className="fill-none stroke-gain" strokeWidth={2.5} strokeLinejoin="round" />

      {breakeven !== null && breakeven > 0 && (
        <g>
          <line x1={x(breakeven)} x2={x(breakeven)} y1={T} y2={H - B} className="stroke-gain/60" strokeDasharray="4 4" />
          <circle cx={x(breakeven)} cy={y(series[breakeven]?.value ?? 0)} r={4} className="fill-background stroke-gain" strokeWidth={2} />
        </g>
      )}

      {p && (
        <g>
          <line x1={x(p.month)} x2={x(p.month)} y1={T} y2={H - B} className="stroke-foreground/70" strokeWidth={1.5} />
          <circle cx={x(p.month)} cy={y(p.balance)} r={6} className="fill-cost stroke-background" strokeWidth={2} />
          <circle cx={x(p.month)} cy={y(p.value)} r={6} className="fill-gain stroke-background" strokeWidth={2} />
        </g>
      )}
    </svg>
    {tooltip && p && (
      <div
        className="glass pointer-events-none absolute top-2 z-10 w-40 rounded-xl px-3 py-2 text-[11px] transition-[left] duration-75"
        style={{ left: `clamp(0px, calc(${tipLeft}% ${tipLeft > 60 ? "- 10.5rem" : "+ 0.75rem"}), calc(100% - 10rem))` }}
      >
        <div className="truncate font-medium text-foreground">{tooltip.vehicle}</div>
        <div className="num mt-1 flex justify-between text-muted-foreground">Month <span className="text-foreground">{p.month}</span></div>
        <div className="num flex justify-between text-muted-foreground">
          Equity
          <span className={p.equity >= 0 ? "text-gain" : "text-loss"}>
            {p.equity >= 0 ? "+" : "−"}${Math.abs(Math.round(p.equity)).toLocaleString("en-US")}
          </span>
        </div>
        <div className="num flex justify-between text-muted-foreground">Odometer <span className="text-foreground">{tooltip.odometer.toLocaleString("en-US")}</span></div>
      </div>
    )}
    </div>
  );
}
