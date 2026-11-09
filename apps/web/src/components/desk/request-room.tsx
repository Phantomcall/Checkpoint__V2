"use client";

import { AlertTriangle, ArrowLeft, Check, CircleSlash, FlaskConical, ScanSearch, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useReducer, useState } from "react";
import { HeaderRings, LockChips, type LockName } from "@/components/page-header";
import { TrustLabel } from "@/components/trust-label";
import { agents } from "@/lib/agents/client";
import { canCancel, initialDesk, reduceDesk, stageOf, type Tone } from "@/lib/agents/reducer";
import { humanError } from "@/lib/errors";
import { approveBasket } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { BasketCard } from "./basket-card";
import { IntentsQuote } from "./intents-quote";
import { OffersBoard } from "./offers-board";
import { Timeline } from "./timeline";

const TONE: Record<Tone, string> = { info: "text-info ring-info/30", warn: "text-warn ring-warn/30", ok: "text-ok ring-ok/30", bad: "text-bad ring-bad/30" };

export function RequestRoom({ id }: { id: string }) {
  const [view, dispatch] = useReducer(reduceDesk, undefined, initialDesk);
  const [conn, setConn] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [ackd, setAckd] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [guardKey, setGuardKey] = useState<string | null>(null);
  const [devWallet, setDevWallet] = useState(agents.mode === "mock");
  const { accountId, send, signIn } = useWallet();

  useEffect(() => agents.subscribe(id, dispatch, setConn), [id]);
  useEffect(() => {
    agents.catalog().then((c) => setTitles(Object.fromEntries(c.map((i) => [i.item_key, i.title])))).catch(() => {});
    agents.guardPubkey().then(setGuardKey);
    agents.hasDevWallet().then(setDevWallet);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Agent and stand-in errors carry a readable message; wallet and chain errors go through the ERR_ map. */
  async function act(key: string, f: () => Promise<void>, wallet = false) {
    setBusy(key);
    try {
      await f();
    } catch (e) {
      setToast({ tone: "bad", text: wallet ? humanError(e) : e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const acknowledge = (offerIds: string[]) => act(offerIds.length === 1 ? offerIds[0]! : "ack", () => agents.acknowledge(id, offerIds));

  const approve = () =>
    act("approve", async () => {
      const s = view.signed;
      if (!s || !view.owner_id) return;
      if (devWallet) return agents.devApprove(s.hash_hex, view.owner_id, s.expires_at_ms, id);
      if (!accountId) return void (await signIn());
      if (accountId !== view.owner_id) throw new Error(`You're signed in as ${accountId}, but this basket is made out to ${view.owner_id}. Only the owner can approve it.`);
      await send(approveBasket(s.hash_hex, String(s.expires_at_ms)));
      setToast({ tone: "ok", text: "Approval sent. The settlement agent picks it up within a few seconds." });
    }, !devWallet);

  const st = stageOf(view);
  // The header dial lights each lock as the request passes it: Guard signs, you approve, the Vault pays.
  const locks: LockName[] = [];
  if (view.signed) locks.push("guard");
  if (view.state === "executing" || view.state === "final") locks.push("you");
  if (view.settlement.final_status && view.settlement.final_status !== "Failed") locks.push("vault");
  const firstLine = view.text.split("\n")[0] ?? "";
  const fatal = view.errors.filter((e) => !e.recoverable && e.code !== "CANCELLED");
  const notes = view.errors.filter((e) => e.recoverable);

  return (
    <div className="pt-10">
      <Link href="/desk" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" /> Desk
      </Link>
      <div className="relative isolate mt-4 flex flex-wrap items-end justify-between gap-4 pb-8">
        <HeaderRings locks={locks} />
        <div className="min-w-0">
          <p className="eyebrow">Request · {id.slice(0, 8)}</p>
          <h1 className="mt-2 truncate text-3xl font-semibold text-fg sm:text-4xl">{view.items.length ? `${view.items.length} item${view.items.length > 1 ? "s" : ""}` : firstLine || "Loading…"}</h1>
          {view.text && <p className="mt-2 max-w-2xl truncate font-mono text-[12px] text-muted">{view.text.replace(/\n/g, " · ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LockChips locks={locks} />
          {devWallet && (
            <span
              title={agents.mode === "mock" ? "The agents pipeline runs in this browser over the frozen snapshot" : "Connected to `pnpm mock`: the real agents service with a fake chain"}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] tracking-[0.12em] text-info uppercase ring-1 ring-inset ring-info/30"
            >
              <FlaskConical aria-hidden className="size-3.5" /> {agents.mode === "mock" ? "In-browser agents" : "Dev service"}
            </span>
          )}
          <span aria-live="polite" className={`rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ring-inset ${TONE[st.tone]}`}>
            {st.label}
          </span>
          {canCancel(view) && view.request_id && (
            <button onClick={() => act("cancel", () => agents.cancel(id))} disabled={busy === "cancel"} className="key key-ghost h-8 px-3 text-xs">
              <CircleSlash aria-hidden className="size-3.5" /> Cancel request
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,420px)]">
        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <div className="panel rounded-[var(--radius-card)] p-3">
            <p className="eyebrow px-2.5 pt-1.5 pb-2">Agent timeline</p>
            <Timeline view={view} />
          </div>
          {conn && (
            <p role="status" className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn ring-1 ring-inset ring-warn/30">
              <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0" /> {conn}
            </p>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          {view.unmatched.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn ring-1 ring-inset ring-warn/30">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Not in the catalogue, so nothing was guessed: <span className="font-mono">{view.unmatched.map((u) => `“${u.text}”`).join(", ")}</span>
              </span>
            </div>
          )}
          {fatal.map((e, i) => (
            <div key={`f${i}`} role="alert" className="flex items-start gap-3 rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad ring-1 ring-inset ring-bad/30">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {e.message} <span className="font-mono text-[11px] opacity-70">{e.code}</span>
              </span>
            </div>
          ))}
          {notes.map((e, i) => (
            <div key={`n${i}`} className="flex items-start gap-3 rounded-2xl px-4 py-3 text-[12.5px] text-muted ring-1 ring-inset ring-line">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                {e.message} <span className="font-mono text-[11px] opacity-70">{e.code}</span>
              </span>
            </div>
          ))}
          {view.offers.length === 0 && !fatal.length ? (
            <div className="panel flex flex-col items-center rounded-[var(--radius-card)] py-20 text-center">
              <ScanSearch aria-hidden className="size-8 animate-pulse text-accent" />
              <p className="mt-3 text-sm text-fg">{conn ? "Waiting for the agents service" : "Agents are reading your list"}</p>
              <p className="mt-1 font-mono text-[11px] text-muted">offers appear here as they&apos;re found</p>
            </div>
          ) : (
            <OffersBoard view={view} titles={titles} onAck={(oid) => acknowledge([oid])} acking={busy} />
          )}
        </div>

        <div className="space-y-4 lg:col-span-2 lg:col-start-2 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:sticky xl:top-28 xl:self-start">
          {view.needs_ack && (
            <section className="panel rounded-[var(--radius-card)] p-5 ring-1 ring-inset ring-warn/30">
              <p className="eyebrow text-warn">Your review</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-fg">Some lines need a second look</h2>
              <p className="mt-1 text-[13px] text-muted">The best offer for these items is flagged, not blocked. It goes in only if you say so, and Guard re-checks it before signing.</p>
              <ul className="mt-4 space-y-2">
                {view.needs_ack.reasons.map(({ offer_id: oid, findings }) => {
                  const o = view.offers.find((x) => x.offer_id === oid);
                  const on = ackd.has(oid);
                  return (
                    <li key={oid}>
                      <label className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-inset transition-colors ${on ? "bg-warn-soft ring-warn/40" : "ring-line"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setAckd((s) => {
                              const n = new Set(s);
                              if (on) n.delete(oid);
                              else n.add(oid);
                              return n;
                            })
                          }
                          className="mt-0.5 accent-[var(--color-warn)]"
                        />
                        <span className="text-[13px]">
                          <span className="block font-medium text-fg">{o?.seller_name ?? oid}</span>
                          {findings.map((f) => (
                            <span key={f.rule_id} className="block text-warn">
                              <span className="font-mono text-[11px] opacity-80">{f.rule_id}</span> {f.message}
                            </span>
                          ))}
                          <span className="block text-[11.5px] text-muted">I reviewed this and want it in the basket.</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button onClick={() => acknowledge(view.needs_ack!.offer_ids)} disabled={busy === "ack" || view.needs_ack.offer_ids.some((o) => !ackd.has(o))} className="key key-secondary mt-4 h-10 w-full text-sm">
                <Check aria-hidden className="size-4" /> Acknowledge and re-plan
              </button>
            </section>
          )}
          {view.refusal && (
            <section role="alert" className="panel rounded-[var(--radius-card)] p-5 ring-1 ring-inset ring-bad/30">
              <p className="eyebrow text-bad">{view.refusal.code === "GUARD_UNAVAILABLE" ? "Guard is unavailable" : "Guard refused to sign"}</p>
              <p className="mt-2 text-[13px] text-fg">{view.refusal.message}</p>
              <ul className="mt-2 space-y-1 text-[13px] text-bad">
                {view.refusal.findings.map((f, i) => (
                  <li key={`${f.rule_id}${i}`}>
                    <span className="mr-2 font-mono text-[11px]">{f.rule_id}</span>
                    {f.message}
                  </li>
                ))}
              </ul>
              <p className="mt-3 font-mono text-[10.5px] text-faint">{view.refusal.code} · no signature, so nothing can be paid</p>
            </section>
          )}
          <BasketCard view={view} devWallet={devWallet} guardPubkey={guardKey} onApprove={approve} approving={busy === "approve"} />
          {view.explanations.basket && (
            <p className="flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-muted">
              <TrustLabel kind="advisory" /> <span>{view.explanations.basket.text}</span>
            </p>
          )}
          {view.basket && !["refused", "cancelled"].includes(view.state) && <IntentsQuote requestId={id} total={view.basket.total} />}
        </div>
      </div>

      {toast && (
        <div role="status" className={`glass fixed right-5 bottom-5 z-50 max-w-sm rounded-2xl px-4 py-3 text-[13px] ${toast.tone === "ok" ? "text-ok" : "text-bad"}`} style={{ animation: "fade-up 300ms var(--ease-out-soft)" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
