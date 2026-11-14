import { Ban, Check, CircleCheck, Fingerprint, KeyRound, TriangleAlert } from "lucide-react";
import { TrustLabel } from "@/components/trust-label";
import { DEMO_HASH } from "@/lib/demo";
import { shortHash } from "@/lib/format";

/**
 * The three locks, told over the vault as it opens: Guard while the wheel turns, You as the bolts pull back,
 * the Vault once you're inside with the gold. Each card is a brass-edged plate; `step` is how far its little
 * demo has played, set by the hero from scroll position:
 *   guard 0-4 offers judged, 5 signed · you 1 request shown, 2 approved, 3 bolts released · vault 0-6 checks, 7 paid.
 * The cards stay dark in both themes because they always sit over the vault, so colours here are fixed values.
 */
export type LockSteps = { guard: number; you: number; vault: number };
export const ALL_DONE: LockSteps = { guard: 5, you: 3, vault: 7 };

// verdict inks, as CSS variables so the porcelain (light) cards can use deeper ones (globals.css, .vault-card)
const INK = { allow: "var(--vc-allow)", review: "var(--vc-review)", block: "var(--vc-block)" };

const GUARD_ROWS = [
  { item: "VPS", seller: "AWS Lightsail", price: "$24.00", bps: 10000, level: "ALLOW" },
  { item: "VPS", seller: "OVHcloud", price: "$4.54", bps: 1891, level: "REVIEW" },
  { item: "Storage", seller: "Cloudflare R2", price: "$15.00", bps: 18773, level: "BLOCK" },
  { item: "Domain", seller: "Gandi", price: "$11.71", bps: 9960, level: "ALLOW" },
] as const;

const VAULT_CHECKS = ["Guard's signature", "Your approval", "Vendor allowlist", "Token allowlist", "Basket and daily caps", "Expiry and replay"];

function CardHead({ n, of, name, tagline, kind }: { n: string; of: string; name: string; tagline: string; kind: "advisory" | "onchain" }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="medallion">
          <span>{n}</span>
        </span>
        <p className="font-engrave text-[10.5px] font-semibold tracking-[0.24em] vc-muted uppercase">
          Lock {of}
          <span className="@max-[27rem]:hidden"> of three</span>
        </p>
        <span className="ml-auto">
          <TrustLabel kind={kind} />
        </span>
      </div>
      <h3 className="mt-4 flex flex-wrap items-baseline gap-x-3 max-sm:mt-3">
        <span className="display text-[46px] vc-fg max-sm:text-[36px]">{name}</span>
        <span className="font-script text-[27px] leading-none vc-gold max-sm:text-[22px]">{tagline}</span>
      </h3>
    </>
  );
}

function Stamp({ level, on }: { level: "ALLOW" | "REVIEW" | "BLOCK"; on: boolean }) {
  const { c, Icon, label } = {
    ALLOW: { c: INK.allow, Icon: CircleCheck, label: "Allow" },
    REVIEW: { c: INK.review, Icon: TriangleAlert, label: "Review" },
    BLOCK: { c: INK.block, Icon: Ban, label: "Block" },
  }[level];
  return (
    <span
      data-on={on}
      className="stamp inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px font-engrave text-[10px] font-semibold tracking-[0.12em] uppercase"
      style={{ color: c, borderColor: `color-mix(in srgb, ${c} 53%, transparent)`, background: `color-mix(in srgb, ${c} 8%, transparent)` }}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

export function GuardCard({ step }: { step: number }) {
  const signed = step >= 5;
  return (
    <div className="vault-card @container p-6 max-sm:p-4">
      <Screws />
      <CardHead n="I" of="one" name="Guard" tagline="checks every price" kind="advisory" />
      <p className="mt-2 text-[14px] leading-relaxed vc-body max-sm:hidden">
        A deterministic rules engine. It loads the offers itself, never trusting the agents&apos; prices, compares each to the market
        median and signs only the exact basket it checked.
      </p>
      <div className="mt-5 border-t vc-line pt-4 max-sm:mt-3 max-sm:pt-3">
        <ul className="space-y-2.5 max-sm:space-y-2">
          {GUARD_ROWS.map((r, i) => {
            const on = step > i;
            const ink = r.level === "ALLOW" ? INK.allow : r.level === "REVIEW" ? INK.review : INK.block;
            return (
              <li key={r.seller} className="grid grid-cols-[104px_1fr_46px_66px] items-center gap-3 text-[12.5px] max-sm:grid-cols-[92px_1fr_40px_62px] max-sm:gap-2">
                <span className="min-w-0">
                  <span className="block truncate vc-fg">{r.seller}</span>
                  <span className="block font-mono text-[10px] vc-faint">
                    {r.item} · {r.price}
                  </span>
                </span>
                <span className="guard-scale relative h-1.5 rounded-full">
                  <span
                    className="guard-needle absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 vc-needle-ring"
                    style={{ left: on ? `${Math.min(r.bps / 16000, 1) * 100}%` : "0%", opacity: on ? 1 : 0, background: ink, boxShadow: on ? `0 0 10px color-mix(in srgb, ${ink} 90%, transparent)` : "none" }}
                  />
                </span>
                <span className="text-right font-mono text-[10.5px] vc-muted tabular">{on ? `${Math.round(r.bps / 100)}%` : "—"}</span>
                <span className="text-right">
                  <Stamp level={r.level} on={on} />
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-center gap-3 max-sm:mt-3">
          <span data-on={signed} className="seal seal-disc grid size-9 shrink-0 place-items-center rounded-full text-[#3a2508]">
            <Check aria-hidden className="size-4" strokeWidth={3} />
          </span>
          <p className="min-w-0 text-[12.5px] leading-snug">
            {signed ? (
              <>
                <span className="vc-gold">Signed</span> <span className="vc-body">the basket without the blocked offer</span>
                <span className="block truncate font-mono text-[10.5px] vc-faint">ed25519 · {shortHash(DEMO_HASH, 7)}</span>
              </>
            ) : (
              <span className="vc-faint">Judging each price against its median…</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function YouCard({ step }: { step: number }) {
  const approved = step >= 2;
  return (
    <div className="vault-card @container p-6 max-sm:p-4">
      <Screws />
      <CardHead n="II" of="two" name="You" tagline="approve the exact basket" kind="onchain" />
      <p className="mt-2 text-[14px] leading-relaxed vc-body max-sm:hidden">
        Your wallet approves the sha256 of the exact basket bytes, with 1 yocto attached so it needs a full-access key. Change one vendor or one
        unit and the approval no longer matches.
      </p>
      <div className="mt-5 rounded-2xl vc-well p-4 max-sm:mt-3 max-sm:p-3">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="flex items-center gap-1.5 vc-fg">
            <KeyRound aria-hidden className="size-3.5 vc-gold" /> Wallet request
          </span>
          <span className="font-mono text-[10px] vc-faint">testnet</span>
        </div>
        <dl className="mt-2.5 space-y-1.5 font-mono text-[11px] max-sm:space-y-1">
          {[
            ["contract", "vault.cpdemo.testnet"],
            ["method", "approve_basket"],
            ["hash_hex", shortHash(DEMO_HASH, 7)],
            ["deposit", "1 yocto"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="vc-faint">{k}</dt>
              <dd className="truncate vc-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <span className={`key key-secondary h-9 text-[12.5px] transition-opacity duration-500 ${approved ? "opacity-40" : ""}`}>Reject</span>
          <span className="key key-primary relative h-9 overflow-hidden text-[12.5px]">
            <span aria-hidden className="press-fill absolute inset-0 bg-[linear-gradient(90deg,rgb(255_250_225/0.55),rgb(255_250_225/0.2))]" />
            {approved ? (
              <span className="relative flex items-center gap-1.5">
                <Check aria-hidden className="size-3.5" strokeWidth={3} /> Approved
              </span>
            ) : (
              <span className="relative flex items-center gap-1.5">
                <Fingerprint aria-hidden className="size-3.5" /> Approve
              </span>
            )}
          </span>
        </div>
      </div>
      <p data-on={step >= 3} className="ink-in mt-3.5 text-[12.5px] vc-body max-sm:mt-2.5">
        <span className="vc-gold">Bolts released.</span> This approval opens this basket and nothing else.
      </p>
    </div>
  );
}

export function VaultCard({ step }: { step: number }) {
  const paid = step >= 7;
  const used = Math.min(step, 6) / 6;
  return (
    <div className="vault-card @container p-6 max-sm:p-4">
      <Screws />
      <CardHead n="III" of="three" name="Vault" tagline="keeps the money in" kind="onchain" />
      <p className="mt-2 text-[14px] leading-relaxed vc-body max-sm:hidden">
        A Rust contract holding the cpUSD. It re-checks Guard&apos;s signature, your approval, the allowlists, caps and expiry, then pays each vendor
        and settles from callbacks only.
      </p>
      <div className="mt-5 border-t vc-line pt-4 max-sm:mt-3 max-sm:pt-3">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span className="vc-muted">Daily cap</span>
          <span className="font-mono vc-fg tabular">{(81.66 * used).toFixed(2)} / 1000.00</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full vc-track">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#b8842f,#f6dc9c,#d29f45)] transition-[width] duration-700" style={{ width: `${8.166 * used}%` }} />
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] max-sm:mt-3 max-sm:gap-y-1.5">
          {VAULT_CHECKS.map((c, i) => {
            const on = step > i;
            return (
              <li key={c} className={`flex items-center gap-1.5 transition-colors duration-500 ${on ? "vc-fg" : "vc-faint"}`}>
                <span
                  className={`grid size-4 shrink-0 place-items-center rounded-full transition-all duration-500 ${
                    on ? "bg-[#e3b45e] text-[#2a1b05] shadow-[0_0_10px_rgb(227_180_94/0.7)]" : "ring-1 vc-ring"
                  }`}
                >
                  {on && <Check aria-hidden className="size-2.5" strokeWidth={3.5} />}
                </span>
                {c}
              </li>
            );
          })}
        </ul>
        <p data-on={paid} className="ink-in mt-4 rounded-xl vc-well vc-body px-3 py-2.5 font-mono text-[11px] leading-relaxed max-sm:mt-3">
          <span className="vc-gold">Paid</span> vendor-02 59.71 · vendor-03 15.00
          <span className="block vc-faint">vendor-06 couldn&apos;t receive · 6.95 back in your vault</span>
        </p>
      </div>
    </div>
  );
}

/** Four slotted screws holding a plate on, each turned a little differently. */
export function Screws({ inset = 10 }: { inset?: number }) {
  const at: (React.CSSProperties & { r: string })[] = [
    { top: inset, left: inset, r: "35deg" },
    { top: inset, right: inset, r: "-20deg" },
    { bottom: inset, left: inset, r: "70deg" },
    { bottom: inset, right: inset, r: "10deg" },
  ];
  return (
    <>
      {at.map(({ r, ...pos }, i) => (
        <span key={i} aria-hidden className="screw" style={{ ...pos, "--r": r } as React.CSSProperties} />
      ))}
    </>
  );
}
