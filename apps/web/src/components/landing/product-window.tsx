import { Check, CircleDashed, Copy, Fingerprint, Loader2 } from "lucide-react";
import { VerdictBadge } from "@/components/verdict-badge";
import { TrustLabel } from "@/components/trust-label";
import { DEMO_HASH, DEMO_PAYOUTS, DEMO_TOTAL, STORAGE_OFFERS } from "@/lib/demo";
import { formatAmount, formatBps, formatUsdMicro, shortHash } from "@/lib/format";

const LANES = [
  { name: "Research", detail: "4 items · 18 offers", state: "done" },
  { name: "Guard", detail: "3 blocked · 5 flagged", state: "done" },
  { name: "Coordinator", detail: "3 vendors · 81.66 cpUSD", state: "done" },
  { name: "Approval", detail: "waiting for your wallet", state: "active" },
  { name: "Settlement", detail: "—", state: "todo" },
] as const;

/** A still of the live request page (/desk/[id]) built from snapshot data. */
export function ProductWindow() {
  return (
    <div className="glass overflow-hidden rounded-[24px]">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-fg)_18%,transparent)]" />
          <span className="size-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-fg)_18%,transparent)]" />
          <span className="size-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-fg)_18%,transparent)]" />
        </span>
        <span className="mx-auto rounded-full border border-line px-3 py-0.5 font-mono text-[11px] text-faint">checkpoint / desk / 7c1e…a90b</span>
      </div>

      <div className="grid lg:grid-cols-[230px_1fr]">
        {/* timeline */}
        <ol className="space-y-1 border-b border-line p-4 lg:border-r lg:border-b-0">
          <p className="eyebrow mb-3 px-2">Agent timeline</p>
          {LANES.map((l) => (
            <li key={l.name} className={`flex gap-3 rounded-xl px-2 py-2 ${l.state === "active" ? "bg-accent-soft" : ""}`}>
              <span className="mt-0.5">
                {l.state === "done" ? (
                  <Check aria-hidden className="size-4 text-accent" />
                ) : l.state === "active" ? (
                  <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
                ) : (
                  <CircleDashed aria-hidden className="size-4 text-faint" />
                )}
              </span>
              <span>
                <span className={`block text-[13px] font-medium ${l.state === "todo" ? "text-faint" : "text-fg"}`}>{l.name}</span>
                <span className="block font-mono text-[10.5px] text-muted">{l.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 p-4 xl:grid-cols-[1.25fr_1fr]">
          {/* offers */}
          <div className="panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-fg">Object storage · 1 TB · 1 month</p>
              <span className="font-mono text-[10.5px] text-muted">median $7.99</span>
            </div>
            <table className="mt-3 w-full text-[12.5px]">
              <thead>
                <tr className="text-left font-mono text-[10px] tracking-wider text-faint uppercase">
                  <th className="pb-2 font-normal">Seller</th>
                  <th className="pb-2 text-right font-normal">Price</th>
                  <th className="w-[34%] pb-2 pl-3 font-normal">vs median</th>
                  <th className="pb-2 text-right font-normal">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {STORAGE_OFFERS.map((o, i) => (
                  <tr key={o.seller} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-1.5 font-medium text-fg">
                        {o.seller}
                        {i === 0 && <span className="rounded bg-accent-soft px-1 font-mono text-[9px] text-accent">PICK</span>}
                      </span>
                      <span className="font-mono text-[10px] text-faint">{o.vendor} · {o.rule}</span>
                    </td>
                    <td className="py-2 text-right font-mono text-fg tabular">{formatUsdMicro(o.priceMicro)}</td>
                    <td className="py-2 pl-3">
                      <RatioBar bps={o.bps} level={o.level} />
                    </td>
                    <td className="py-2 text-right">
                      <VerdictBadge level={o.level} size="xs" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* basket */}
          <div className="panel edge-light flex flex-col rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-fg">Basket</p>
              <span className="font-mono text-[10.5px] text-warn">expires 14:21</span>
            </div>
            <ul className="mt-3 space-y-2">
              {DEMO_PAYOUTS.map((p) => (
                <li key={p.vendor} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0">
                    <span className="block font-mono text-fg">{p.vendor}</span>
                    <span className="block truncate text-[11px] text-faint">stand-in for {p.standIn}</span>
                  </span>
                  <span className="font-mono text-fg tabular">{formatAmount(p.amount, { symbol: null })}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[12px] text-muted">Total</span>
              <span className="text-xl font-semibold text-fg tabular">{formatAmount(DEMO_TOTAL)}</span>
            </div>
            <div className="mt-3 rounded-xl border border-line bg-[color-mix(in_srgb,var(--color-bg)_50%,transparent)] p-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted uppercase">
                  <Fingerprint aria-hidden className="size-3.5" /> sha256
                </span>
                <Copy aria-hidden className="size-3.5 text-faint" />
              </div>
              <p className="mt-1 font-mono text-[11.5px] text-fg">{shortHash(DEMO_HASH, 10)}</p>
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-accent">
                <Check aria-hidden className="size-3.5" /> Decoded and re-hashed in your browser
              </p>
            </div>
            <div className="mt-auto pt-4">
              <span className="key key-primary h-10 w-full text-[13.5px]">Approve exact basket</span>
              <div className="mt-2 flex justify-center">
                <TrustLabel kind="onchain" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Price as a share of the median on a 0–160% scale, with the rule zones behind it. */
export function RatioBar({ bps, level }: { bps: number; level: "ALLOW" | "REVIEW" | "BLOCK" }) {
  const pct = Math.min(bps / 16000, 1) * 100;
  const dot = { ALLOW: "bg-ok", REVIEW: "bg-warn", BLOCK: "bg-bad" }[level];
  return (
    <span className="flex items-center gap-2">
      <span className="ratio-scale relative h-1.5 flex-1 rounded-full">
        <span className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-surface)] ${dot}`} style={{ left: `${pct}%` }} />
      </span>
      <span className="w-10 text-right font-mono text-[10.5px] text-muted tabular">{formatBps(bps)}</span>
    </span>
  );
}
