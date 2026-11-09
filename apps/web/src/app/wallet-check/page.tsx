"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { accountUrl, config, txUrl } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { formatNear } from "@/lib/format";
import { storageDeposit, storageMin, txHash, type Tx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

/**
 * P-0.3 day-1 check: sign in on testnet and send one deposit-bearing FunctionCall from the browser.
 * Not linked from the nav. Remove once the Vault page covers the same path.
 */
export default function WalletCheckPage() {
  const { ready, accountId, walletName, signIn, send } = useWallet();
  const [token, setToken] = useState<string>(config.tokenId);
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "err"; text?: string; hash?: string }>({ kind: "idle" });

  async function run(build: () => Promise<Tx>) {
    setStatus({ kind: "busy", text: "Waiting for your wallet…" });
    try {
      const tx = await build();
      const outcome = await send(tx);
      setStatus({ kind: "ok", text: `${tx.label}: sent`, hash: txHash(outcome) ?? undefined });
    } catch (e) {
      console.error(e);
      setStatus({ kind: "err", text: humanError(e) });
    }
  }

  return (
    <>
      <PageHeader eyebrow="Day-1 check · P-0.3" title="Wallet check" accent="Wallet" locks={["you"]} intro="Day-1 check (P-0.3): sign in with a testnet wallet, then sign one FunctionCall that attaches a deposit." />
      <ol className="max-w-3xl space-y-4">
        <li className="panel rounded-[var(--radius-card)] p-6">
          <h2 className="font-semibold text-fg">1. Sign in on testnet</h2>
          <p className="mt-1 text-sm text-muted">Use Meteor, Intear or Nightly. They are the testnet-capable wallets in the NEAR Connect manifest.</p>
          <div className="mt-3">
            {!ready ? (
              <span className="text-sm text-muted">Loading NEAR Connect…</span>
            ) : accountId ? (
              <p className="text-sm">
                Signed in as{" "}
                <a className="font-mono text-accent underline underline-offset-4" href={accountUrl(accountId)} target="_blank" rel="noreferrer">
                  {accountId}
                </a>
                {walletName && <span className="text-muted"> via {walletName}</span>}
              </p>
            ) : (
              <button onClick={() => signIn()} className="key key-primary h-10 px-5 text-sm">
                Sign in
              </button>
            )}
          </div>
        </li>
        <li className="panel rounded-[var(--radius-card)] p-6">
          <h2 className="font-semibold text-fg">2. Sign a FunctionCall with a deposit</h2>
          <p className="mt-1 text-sm text-muted">
            Registers your account on a NEP-141 token with <code>storage_deposit</code>, attaching the token&apos;s minimum storage deposit. Use{" "}
            <code>{config.tokenId}</code> once cpUSD is deployed, or <code>wrap.testnet</code> before that.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-xs text-muted">Token contract</span>
              <input value={token} onChange={(e) => setToken(e.target.value.trim())} className="mt-1.5 h-10 w-72 rounded-full border border-line bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] px-4 font-mono text-sm text-fg" />
            </label>
            <button onClick={() => setToken("wrap.testnet")} className="key key-secondary h-10 px-4 text-sm">
              Use wrap.testnet
            </button>
            <button
              disabled={!accountId || status.kind === "busy"}
              onClick={() =>
                run(async () => {
                  const min = await storageMin(token);
                  setStatus({ kind: "busy", text: `Approve ${formatNear(min, 5)} storage deposit in your wallet…` });
                  return storageDeposit(accountId!, min, token);
                })
              }
              className="key key-primary h-10 px-5 text-sm"
            >
              Send storage_deposit
            </button>
          </div>
          {status.kind !== "idle" && (
            <p role="status" className={`mt-3 text-sm ${status.kind === "err" ? "text-bad" : status.kind === "ok" ? "text-ok" : "text-muted"}`}>
              {status.text}
              {status.hash && (
                <>
                  {" · "}
                  <a className="font-mono underline" href={txUrl(status.hash)} target="_blank" rel="noreferrer">
                    {status.hash.slice(0, 10)}…
                  </a>
                </>
              )}
            </p>
          )}
        </li>
      </ol>
    </>
  );
}
