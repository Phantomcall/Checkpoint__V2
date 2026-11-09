"use client";

import { basketHashHex, decodePayload, fromBase58, fromBase64, fromHex, toHex, verifyBasketSignature, type BasketPayloadV1 } from "@checkpoint/shared";
import { ArrowDownLeft, ArrowRight, Check, CircleDashed, Copy, ExternalLink, Fingerprint, FlaskConical, Loader2, Receipt, ShieldAlert, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TrustLabel } from "@/components/trust-label";
import type { DeskView } from "@/lib/agents/reducer";
import { txUrl } from "@/lib/config";
import { formatAmount } from "@/lib/format";

interface Check {
  status: "ok" | "fail" | "skip";
  label: string;
}

/**
 * Decodes the signed payload from its bytes and checks it before the owner may approve it (P-3.1). The hash,
 * payouts and evidence hash are recomputed here, in the browser, from the exact bytes the Vault will re-hash;
 * nothing is taken from the service's word.
 */
function useVerified(view: DeskView, guardPubkey: string | null) {
  return useMemo(() => {
    const s = view.signed;
    const d = view.basket;
    if (!s || !d) return null;
    try {
      const bytes = fromBase64(s.payload_b64);
      const p = decodePayload(bytes);
      const local = basketHashHex(bytes);
      let sig: Check["status"] = "skip";
      if (guardPubkey) {
        try {
          sig = verifyBasketSignature(fromBase64(s.signature_b64), fromHex(local), fromBase58(guardPubkey)) ? "ok" : "fail";
        } catch {
          sig = "fail";
        }
      }
      const checks: Check[] = [
        { status: local === s.hash_hex ? "ok" : "fail", label: "Hash recomputed in your browser matches" },
        {
          status:
            p.basket_id === d.basket_id && p.total === BigInt(d.total) && p.payouts.length === d.payouts.length && p.payouts.every((x, i) => x.vendor_id === d.payouts[i]!.vendor_id && x.amount === BigInt(d.payouts[i]!.amount))
              ? "ok"
              : "fail",
          label: "Decoded payouts and total match the basket shown",
        },
        { status: toHex(p.evidence_hash) === d.evidence_hash ? "ok" : "fail", label: "Evidence hash is bound into the payload" },
        { status: p.owner_id === view.owner_id ? "ok" : "fail", label: "Basket is made out to you" },
        { status: sig, label: sig === "skip" ? "Guard key unknown here, so the signature is left to the Vault" : "Guard's signature verifies" },
      ];
      return { p, checks, ok: checks.every((c) => c.status !== "fail") };
    } catch {
      return { p: null as BasketPayloadV1 | null, checks: [{ status: "fail", label: "Payload could not be decoded" }] as Check[], ok: false };
    }
  }, [view.signed, view.basket, view.owner_id, guardPubkey]);
}

function useCountdown(toMs?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!toMs) return null;
  const left = Math.max(0, toMs - now);
  return { left, text: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` };
}

export function BasketCard({
  view,
  devWallet,
  guardPubkey,
  onApprove,
  approving,
}: {
  view: DeskView;
  devWallet: boolean;
  guardPubkey: string | null;
  onApprove: () => void;
  approving: boolean;
}) {
  const verified = useVerified(view, guardPubkey);
  const left = useCountdown(view.signed?.expires_at_ms);
  const [copied, setCopied] = useState(false);
  const d = view.basket;
  if (!d) return null;

  const sellers = (vendor: string) =>
    [...new Set(d.lines.filter((l) => l.vendor_id === vendor).map((l) => `${view.offers.find((o) => o.offer_id === l.offer_id)?.seller_name ?? l.offer_id}${l.qty > 1 ? ` ×${l.qty}` : ""}`))].join(", ");
  const payout = (vendor: string) => view.settlement.payouts.find((p) => p.vendor_id === vendor);
  const executing = view.state === "executing" || view.state === "final";
  const expired = view.state === "expired" || (!!left && left.left === 0 && !executing);
  const canApprove = view.state === "awaiting_approval" && !!verified?.ok && !expired && !approving;
  const failed = view.settlement.payouts.filter((p) => p.status === "Failed");
  const reviewedIn = d.lines.filter((l) => l.level === "REVIEW");

  return (
    <section aria-labelledby="basket-title" className="glass edge-light overflow-hidden rounded-[24px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="eyebrow">Basket · {d.basket_id.slice(0, 8)}</p>
          <h2 id="basket-title" className="mt-1 text-lg font-semibold tracking-tight text-fg">
            {executing ? "Settlement" : view.signed ? "Approve this exact basket" : view.needs_ack ? "Basket draft · needs your review" : "Basket draft"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {devWallet && view.signed && (
            <span title="Signed with the published dev Guard key that the keyless demo uses" className="flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wider text-info uppercase ring-1 ring-inset ring-info/30">
              <FlaskConical aria-hidden className="size-3" /> dev key
            </span>
          )}
          {left && view.signed && !executing && (
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] tabular ring-1 ring-inset ${expired || left.left < 120_000 ? "text-bad ring-bad/30" : "text-warn ring-warn/30"}`}>
              <Timer aria-hidden className="size-3.5" /> {expired ? "expired" : `expires in ${left.text}`}
            </span>
          )}
        </div>
      </header>

      <div className="px-5 py-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left font-mono text-[10px] tracking-wider text-faint uppercase">
              <th className="pb-2 font-normal">Vendor</th>
              <th className="px-3 pb-2 text-center font-normal">Lines</th>
              <th className="pb-2 text-right font-normal">Amount</th>
              {executing && <th className="pb-2 pl-3 text-right font-normal">Status</th>}
            </tr>
          </thead>
          <tbody>
            {d.payouts.map((p) => {
              const st = payout(p.vendor_id);
              return (
                <tr key={p.vendor_id} className="border-t border-line align-top">
                  <td className="py-2.5">
                    <span className="block font-mono text-fg">{p.vendor_id.split(".")[0]}</span>
                    <span className="block text-[11.5px] text-faint">stand-in for {sellers(p.vendor_id)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-muted">{p.line_count}</td>
                  <td className={`py-2.5 text-right font-mono tabular ${st?.status === "Failed" ? "text-warn line-through decoration-warn/60" : "text-fg"}`}>{formatAmount(p.amount, { symbol: null })}</td>
                  {executing && (
                    <td className="py-2.5 pl-3 text-right">
                      {!st ? (
                        <Loader2 aria-label="pending" className="ml-auto size-4 animate-spin text-muted" />
                      ) : (
                        <a
                          href={devWallet || !st.tx_hash ? undefined : txUrl(st.tx_hash)}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 font-mono text-[11px] ${st.status === "Completed" ? "text-ok" : "text-warn"}`}
                        >
                          {st.status === "Completed" ? <Check aria-hidden className="size-3.5" /> : <ArrowDownLeft aria-hidden className="size-3.5" />}
                          {st.status === "Completed" ? "paid" : "returned"}
                          {!devWallet && st.tx_hash && <ExternalLink aria-hidden className="size-3" />}
                        </a>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm text-muted">Total</span>
          <span className="text-2xl font-semibold text-fg tabular">{formatAmount(d.total)}</span>
        </div>
        {failed.length > 0 && (
          <p className="mt-2 text-[12px] text-warn">
            {failed.map((p) => `${p.vendor_id.split(".")[0]} couldn't receive cpUSD, so ${formatAmount(p.amount)} went back to your available balance.`).join(" ")}
          </p>
        )}
        {view.acknowledged_offer_ids.length > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            {reviewedIn.length
              ? `${reviewedIn.length} line${reviewedIn.length > 1 ? "s were" : " was"} flagged and acknowledged by you. Guard re-checked ${reviewedIn.length > 1 ? "them" : "it"} before signing.`
              : "You acknowledged a flagged offer, but an allowed offer still came out cheaper, so the basket didn't change."}
          </p>
        )}
      </div>

      {view.signed && verified?.p && (
        <div className="space-y-3 border-t border-line px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] sm:grid-cols-4">
            {[
              ["token", verified.p.token_id.split(".")[0]],
              ["policy", `v${verified.p.policy_version}`],
              ["guard key", `v${verified.p.guard_key_version}`],
              ["nonce", verified.p.nonce.toString().slice(0, 8) + "…"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-faint">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          <div className={`rounded-2xl border p-3 ${verified.ok ? "border-line" : "border-bad/50 bg-bad-soft"}`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted uppercase">
                <Fingerprint aria-hidden className="size-3.5" /> sha256(domain ‖ borsh(payload))
              </span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(view.signed!.hash_hex);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex items-center gap-1 font-mono text-[10.5px] text-muted hover:text-fg"
              >
                {copied ? <Check aria-hidden className="size-3.5 text-accent" /> : <Copy aria-hidden className="size-3.5" />}
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[12px] leading-relaxed break-all text-fg">{view.signed.hash_hex}</p>
            <ul className="mt-3 space-y-1">
              {verified.checks.map((c) => (
                <li key={c.label} className={`flex items-center gap-1.5 text-[12px] ${c.status === "ok" ? "text-accent" : c.status === "skip" ? "text-muted" : "text-bad"}`}>
                  {c.status === "ok" ? <Check aria-hidden className="size-3.5" /> : c.status === "skip" ? <CircleDashed aria-hidden className="size-3.5" /> : <ShieldAlert aria-hidden className="size-3.5" />}
                  {c.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">Decoded from the exact bytes Guard signed and the Vault will re-hash.</p>
          </div>

          {!verified.ok && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad ring-1 ring-inset ring-bad/30">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              Don&apos;t approve. What you see doesn&apos;t match what would be signed. Approval is disabled.
            </p>
          )}

          {!executing && (
            <div>
              <button onClick={onApprove} disabled={!canApprove} className="key key-primary h-12 w-full text-[15px]">
                {approving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Fingerprint aria-hidden className="size-4" />}
                {view.state === "signed" ? "Preparing approval…" : devWallet ? "Approve exact basket · stand-in wallet" : "Approve exact basket"}
              </button>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted">
                <TrustLabel kind="onchain" />
                {devWallet ? "Keyless demo: a stand-in wallet records the approval. No transaction is sent." : "Sends approve_basket(hash, expires_at_ms) with 1 yocto from your wallet."}
              </div>
            </div>
          )}
          {view.settlement.final_status && (
            <p className={`rounded-xl px-3 py-2 text-[13px] ring-1 ring-inset ${view.settlement.final_status === "Completed" ? "bg-ok-soft text-ok ring-ok/30" : "bg-warn-soft text-warn ring-warn/30"}`}>
              Basket {view.settlement.final_status === "PartiallyPaid" ? "partially paid" : view.settlement.final_status.toLowerCase()}.{" "}
              {view.settlement.tx_hash && !devWallet && (
                <a href={txUrl(view.settlement.tx_hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  execute_basket transaction
                </a>
              )}
            </p>
          )}
          {view.settlement.final_status && (
            <Link href={`/audit?basket=${d.basket_id}`} className="key key-secondary h-11 w-full text-sm">
              <Receipt aria-hidden className="size-4" /> See the receipts on Audit <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
