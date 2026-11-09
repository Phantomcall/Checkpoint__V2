/**
 * NEAR Intents 1Click dry quote, for the in-browser mock: the same request David's agents service makes
 * (packages/agents/src/intents.ts, D-6.2), sent straight from the browser, which 1Click allows (CORS *).
 * EXACT_OUTPUT: deliver the basket total as USDC on NEAR, paid from wNEAR. Dry means no deposit address is
 * created and nothing can move. Display-only: never signed, never seen by Guard or the Vault.
 */
export interface IntentsQuote {
  label: string;
  dry: true;
  network: "mainnet";
  pay_asset: string;
  pay_amount: string;
  pay_amount_formatted: string;
  pay_usd: string;
  receive_asset: string;
  receive_amount: string;
  receive_amount_formatted: string;
  time_estimate_s: number;
  quoted_at: string;
  correlation_id: string | null;
}

/** GET /v1/requests/:id/intents-quote */
export interface IntentsQuoteResponse {
  basket_total: string;
  quote: IntentsQuote;
}

const ONECLICK_URL = "https://1click.chaindefuser.com";
const WNEAR = "nep141:wrap.near";
/** Native USDC on NEAR (6 decimals, like cpUSD, so the basket total passes through unchanged). */
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** A well-formed placeholder (the all-zeros implicit account): dry quotes need one but never use it. */
const PLACEHOLDER = "0".repeat(64);

export async function dryQuote(total: string): Promise<IntentsQuoteResponse> {
  if (!/^[1-9]\d*$/.test(total)) throw new Error("The basket total must be a positive amount.");
  let r: Response;
  try {
    r = await fetch(`${ONECLICK_URL}/v0/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: WNEAR,
        depositType: "INTENTS",
        destinationAsset: USDC_NEAR,
        amount: total,
        refundTo: PLACEHOLDER,
        refundType: "INTENTS",
        recipient: PLACEHOLDER,
        recipientType: "INTENTS",
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new Error(`1Click unreachable: ${(e as Error).message}`);
  }
  if (!r.ok) throw new Error(`1Click answered HTTP ${r.status}`);
  const body = (await r.json().catch(() => null)) as { quote?: Record<string, unknown>; timestamp?: string; correlationId?: string } | null;
  const q = body?.quote;
  if (!q || typeof q.amountIn !== "string" || typeof q.amountInFormatted !== "string" || typeof q.amountOut !== "string") throw new Error("1Click returned an unexpected quote shape");
  return {
    basket_total: total,
    quote: {
      label: "Dry quote from NEAR Intents 1Click (mainnet). Illustrative only: nothing is signed or moved.",
      dry: true,
      network: "mainnet",
      pay_asset: WNEAR,
      pay_amount: q.amountIn,
      pay_amount_formatted: q.amountInFormatted,
      pay_usd: String(q.amountInUsd ?? ""),
      receive_asset: USDC_NEAR,
      receive_amount: q.amountOut,
      receive_amount_formatted: String(q.amountOutFormatted ?? ""),
      time_estimate_s: Number(q.timeEstimate ?? 0),
      quoted_at: body?.timestamp ?? new Date().toISOString(),
      correlation_id: body?.correlationId ?? null,
    },
  };
}
