"use client";

import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TrustLabel } from "@/components/trust-label";
import { agents } from "@/lib/agents/client";
import { formatAmount } from "@/lib/format";
import type { IntentsQuoteResponse } from "@/lib/intents";

type State = { s: "loading" } | { s: "off" } | { s: "error"; msg: string } | { s: "ok"; q: IntentsQuoteResponse };

/**
 * D-6.2: what this basket would cost paid from wNEAR through NEAR Intents, as a dry 1Click quote. Advisory:
 * nothing is signed or moved, and neither Guard nor the Vault ever sees it. Hidden when the service has it off.
 */
export function IntentsQuote({ requestId, total }: { requestId: string; total: string }) {
  const [st, setSt] = useState<State>({ s: "loading" });
  const load = useCallback(async () => {
    setSt({ s: "loading" });
    try {
      const q = await agents.intentsQuote(requestId, total);
      setSt(q ? { s: "ok", q } : { s: "off" });
    } catch (e) {
      setSt({ s: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }, [requestId, total]);
  useEffect(() => {
    void load();
  }, [load]);

  if (st.s === "off") return null;
  const q = st.s === "ok" ? st.q.quote : null;
  return (
    <section aria-labelledby="intents-title" className="panel rounded-[var(--radius-card)] p-5">
      <div className="flex items-center justify-between gap-2">
        <p id="intents-title" className="eyebrow">
          Or pay from NEAR
        </p>
        <span className="flex items-center gap-1">
          <TrustLabel kind="advisory" />
          <button onClick={() => void load()} disabled={st.s === "loading"} aria-label="Quote again" className="key key-ghost size-7">
            <RefreshCw aria-hidden className={`size-3.5 ${st.s === "loading" ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      {st.s === "loading" ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Asking NEAR Intents for a dry quote…
        </p>
      ) : st.s === "error" ? (
        <p className="mt-3 text-[13px] text-muted">
          No quote right now. <span className="font-mono text-[11px] text-faint">{st.msg}</span>
        </p>
      ) : (
        q && (
          <>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-2xl font-semibold text-fg tabular">≈ {formatAmount(q.pay_amount, { decimals: 24, shown: 2, symbol: null })}</span>
              <span className="text-sm text-muted">wNEAR</span>
              <ArrowRight aria-hidden className="size-4 self-center text-faint" />
              <span className="font-mono text-[15px] text-fg tabular">{formatAmount(q.receive_amount, { symbol: null })}</span>
              <span className="text-sm text-muted">USDC</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-faint">
              {Number(q.pay_usd) ? `$${Number(q.pay_usd).toFixed(2)} · ` : ""}about {q.time_estimate_s} s · quoted {new Date(q.quoted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
              A dry 1Click quote on mainnet for the basket total: no deposit address, nothing signed or moved. The Vault still pays in cpUSD.
            </p>
          </>
        )
      )}
    </section>
  );
}
