"use client";

import { decodePayload, fromBase64, verifyEvidenceBundle, type Check as VerifyCheck, type VaultBasketView } from "@checkpoint/shared";
import { ArrowDownLeft, Check, ChevronDown, CircleDashed, Copy, Download, ExternalLink, FileSearch, Inbox, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { TrustLabel } from "@/components/trust-label";
import { agents, DEV_GUARD_PUBKEY } from "@/lib/agents/client";
import type { EvidenceBundle } from "@/lib/agents/types";
import { config, txUrl } from "@/lib/config";
import { formatAmount, shortHash } from "@/lib/format";
import { hasContract, vault } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

const DEMO_OWNER = "owner-demo.cpdemo.testnet";

type Status = VaultBasketView["status"];
interface Row {
  basket_id: string;
  hash: string | null;
  created: number;
  total: string;
  status: Status | null;
  payouts: { vendor: string; amount: string; status: string | null }[];
  bundle: EvidenceBundle | null;
  bundleError: string | null;
  checks: VerifyCheck[];
  ok: boolean;
}

/**
 * Where the list came from. The chain is the authority. The agents service is used instead when the Vault isn't
 * deployed, or when `pnpm mock` is behind the app: its baskets settle on a stand-in chain, not on testnet.
 */
type Source = "chain" | "agents";

/** Which terminal command matches where the baskets came from. The dev key is the published `pnpm mock` key. */
type Hint = "chain" | "dev" | "browser";
const TERMINAL_NOTE: Record<Hint, string> = {
  chain: "The same checks, without this website: the bundle from the agents service, the basket from the chain.",
  dev: "The same checks, without this website: the bundle from the agents service, checked against the published dev key it signs with.",
  browser: "The in-browser agents keep bundles in this browser, so download a basket's Evidence JSON first. The key is the published dev key.",
};

async function fetchBundle(basketId: string): Promise<{ bundle: EvidenceBundle | null; error: string | null }> {
  try {
    return { bundle: (await agents.audit(basketId)) as EvidenceBundle, error: null };
  } catch (e) {
    return { bundle: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Before the chain has the basket, the signed payload's own created_at_ms is the best timestamp. */
function createdAt(bundle: EvidenceBundle | null) {
  try {
    return bundle?.signed ? Number(decodePayload(fromBase64(bundle.signed.payload_b64)).created_at_ms) : 0;
  } catch {
    return 0;
  }
}

function toRow(basket_id: string, bundle: EvidenceBundle | null, bundleError: string | null, chain: VaultBasketView | null | undefined, guardKey: string | null): Row {
  const v = bundle ? verifyEvidenceBundle(bundle, { guardPubkeyB58: guardKey, ...(chain !== undefined ? { chainBasket: chain } : {}) }) : { ok: false, checks: [] };
  const fromChain = chain ?? null;
  return {
    basket_id,
    hash: fromChain?.hash ?? bundle?.signed?.hash_hex ?? null,
    created: fromChain ? Number(fromChain.created_at_ms) : createdAt(bundle),
    total: fromChain?.total ?? bundle?.core.basket.total ?? "0",
    status: fromChain?.status ?? bundle?.chain.final_status ?? null,
    payouts: fromChain
      ? fromChain.payouts.map((p) => ({ vendor: p.vendor, amount: p.amount, status: p.status }))
      : (bundle?.core.basket.payouts ?? []).map((p, i) => ({ vendor: p.vendor_id, amount: p.amount, status: bundle?.chain.payouts.find((x) => x.index === i)?.status ?? null })),
    bundle,
    bundleError,
    checks: v.checks,
    ok: !!bundle && v.ok,
  };
}

/** P-4.2: every basket the owner approved, newest first, each re-verified in the browser from its evidence bundle. */
function useAudit(owner: string) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      if (!(await agents.hasDevWallet()) && (await hasContract(config.vaultId))) {
        setSource("chain");
        const [baskets, policy] = await Promise.all([vault.baskets(owner), vault.policy().catch(() => null)]);
        const out = await Promise.all(
          baskets.map(async (b) => {
            const { bundle, error } = await fetchBundle(b.basket_id);
            return toRow(b.basket_id, bundle, error, b, policy?.guard_pubkey ?? null);
          }),
        );
        setRows(out.sort((a, b) => b.created - a.created));
      } else {
        setSource("agents");
        const [list, guardKey] = await Promise.all([agents.listRequests(owner), agents.guardPubkey()]);
        const approved = list.filter((r) => r.state === "final" || r.state === "executing");
        const out = await Promise.all(
          approved.map(async (r) => {
            const view = await agents.requestView(r.request_id);
            const id = view.signed?.basket_id ?? view.basket?.basket_id;
            if (!id) return null;
            const { bundle, error } = await fetchBundle(id);
            return toRow(id, bundle, error, undefined, guardKey);
          }),
        );
        setRows(out.filter((x): x is Row => !!x).sort((a, b) => b.created - a.created));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, source, error, reload: load };
}

export default function AuditPage() {
  const { accountId } = useWallet();
  const owner = accountId ?? DEMO_OWNER;
  const { rows, source, error, reload } = useAudit(owner);
  const [open, setOpen] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<Row | "loading" | { error: string } | null>(null);
  const [dev, setDev] = useState(agents.mode === "mock");
  useEffect(() => {
    agents.hasDevWallet().then(setDev);
  }, []);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const id = lookup.trim();
    if (!id) return;
    setFound("loading");
    const { bundle, error } = await fetchBundle(id);
    if (!bundle) return setFound({ error: error ?? "Not found." });
    let chain: VaultBasketView | null | undefined;
    if (source === "chain" && bundle.signed) chain = await vault.basket(bundle.signed.hash_hex).catch(() => undefined);
    setFound(toRow(id, bundle, null, chain, source === "chain" ? ((await vault.policy().catch(() => null))?.guard_pubkey ?? null) : await agents.guardPubkey()));
  }

  const hint: Hint = source === "chain" ? "chain" : agents.mode === "mock" ? "browser" : dev ? "dev" : "chain";

  useEffect(() => {
    if (rows?.length && open === null) setOpen(rows[0]!.basket_id);
  }, [rows, open]);

  return (
    <>
      <PageHeader eyebrow="Audit" title="Every basket, with receipts" intro="Each basket you approved, its payouts and the evidence behind it. The evidence hash, the basket hash and Guard's signature are recomputed in your browser.">
        <TrustLabel kind="onchain" />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Baskets for <span className="font-mono text-fg">{owner}</span>
          {!accountId && <span className="text-faint"> · sign in to see yours</span>}
          {source && (
            <span className="ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase ring-1 ring-inset ring-line">
              {source === "chain" ? "from the Vault · get_baskets" : agents.mode === "mock" ? "from this browser · in-browser agents" : dev ? "from the agents service · stand-in chain" : "from the agents service · Vault not deployed here"}
            </span>
          )}
        </p>
        <button onClick={() => void reload()} className="key key-ghost h-8 px-3 text-xs">
          <RefreshCw aria-hidden className={`size-3.5 ${rows === null ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad ring-1 ring-inset ring-bad/30">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      <div className="panel overflow-hidden rounded-[var(--radius-card)]">
        {rows === null ? (
          <ul aria-busy className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-4 p-5">
                <span className="size-10 animate-pulse rounded-xl bg-line" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3.5 w-48 animate-pulse rounded bg-line" />
                  <span className="block h-3 w-72 animate-pulse rounded bg-line" />
                </span>
                <span className="h-6 w-24 animate-pulse rounded-full bg-line" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--color-fg)_6%,transparent)] text-muted">
              <Inbox aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm text-fg">No approved baskets yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted">A basket shows up here once you approve it and the Vault starts paying.</p>
            <Link href="/desk" className="key key-secondary mt-5 h-9 px-4 text-[13px]">
              Start a request on the Desk
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <BasketRow key={r.basket_id} r={r} dev={dev} open={open === r.basket_id} onToggle={() => setOpen(open === r.basket_id ? "" : r.basket_id)} />
            ))}
          </ul>
        )}
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={check} className="panel rounded-[var(--radius-card)] p-5">
          <p className="eyebrow">Check any basket</p>
          <p className="mt-2 text-[13px] text-muted">Paste a basket ID. Its evidence bundle is fetched and verified here, the same way as above.</p>
          <div className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="basket-id">
              Basket ID
            </label>
            <input
              id="basket-id"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="304b64d4-2de2-4610-a0f9-661ca43bdb56"
              className="h-10 min-w-0 flex-1 rounded-full border border-line bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] px-4 font-mono text-[12.5px] text-fg placeholder:text-faint focus:border-accent/50 focus:outline-none"
            />
            <button disabled={!lookup.trim() || found === "loading"} className="key key-secondary h-10 px-4 text-[13px]">
              {found === "loading" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />} Verify
            </button>
          </div>
          {found && found !== "loading" && ("error" in found ? <p className="mt-3 text-[13px] text-bad">{found.error}</p> : <ul className="mt-4 rounded-2xl ring-1 ring-line"><BasketRow r={found} dev={dev} open onToggle={() => {}} /></ul>)}
        </form>
        <div className="panel rounded-[var(--radius-card)] p-5">
          <p className="eyebrow">Or verify from a terminal</p>
          <p className="mt-2 text-[13px] text-muted">{TERMINAL_NOTE[hint]}</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] p-4 font-mono text-[12px] leading-relaxed text-fg ring-1 ring-line">
            <span className="text-faint">$ </span>pnpm verify:audit {"<basket_id>"} \{"\n"}
            {"    "}
            {hint === "chain" ? `--rpc ${config.rpcUrl} --vault ${config.vaultId}` : `${hint === "browser" ? "--file evidence-<basket_id>.json " : ""}--pubkey ${DEV_GUARD_PUBKEY}`}
          </pre>
        </div>
      </section>
    </>
  );
}

const STATUS: Record<Status, { cls: string; label: string }> = {
  Completed: { cls: "bg-ok-soft text-ok ring-ok/25", label: "Completed" },
  PartiallyPaid: { cls: "bg-warn-soft text-warn ring-warn/25", label: "Partially paid" },
  Failed: { cls: "bg-bad-soft text-bad ring-bad/25", label: "Failed" },
  Executing: { cls: "text-info ring-info/30", label: "Executing" },
};

/** dev: the stand-in chain (in-browser or `pnpm mock`), whose transaction hashes exist nowhere, so no explorer links. */
function BasketRow({ r, open, onToggle, dev }: { r: Row; open: boolean; onToggle: () => void; dev: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (k: string, v: string) => {
    navigator.clipboard?.writeText(v);
    setCopied(k);
    setTimeout(() => setCopied(null), 1400);
  };
  const st = r.status ? STATUS[r.status] : null;
  const exec = r.bundle?.chain.execute_tx;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.bundle, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `evidence-${r.basket_id}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <li>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_3%,transparent)] sm:p-5">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${r.ok ? "bg-accent-soft text-accent ring-accent/25" : "bg-bad-soft text-bad ring-bad/25"}`}>
          {r.ok ? <ShieldCheck aria-hidden className="size-5" /> : <ShieldAlert aria-hidden className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] text-fg">{r.basket_id.slice(0, 8)}</span>
            <span className={`font-mono text-[10.5px] ${r.ok ? "text-accent" : "text-bad"}`}>{r.ok ? "verified" : r.bundle ? "check failed" : "no evidence"}</span>
          </span>
          <span className="block truncate font-mono text-[11px] text-faint">
            {r.created ? new Date(r.created).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"} · {r.payouts.length} vendor{r.payouts.length === 1 ? "" : "s"}
            {r.hash ? ` · ${shortHash(r.hash, 8)}` : ""}
          </span>
        </span>
        <span className="hidden font-mono text-[15px] text-fg tabular sm:block">{formatAmount(r.total)}</span>
        {st && <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${st.cls}`}>{st.label}</span>}
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="grid gap-5 border-t border-line px-4 pt-4 pb-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" style={{ animation: "fade-up 300ms var(--ease-out-soft)" }}>
          <div>
            <p className="eyebrow">Payouts</p>
            <ul className="mt-2 divide-y divide-line">
              {r.payouts.map((p) => (
                <li key={p.vendor} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-fg">{p.vendor.split(".")[0]}</span>
                  <span className={`font-mono tabular ${p.status === "Failed" ? "text-warn line-through decoration-warn/60" : "text-fg"}`}>{formatAmount(p.amount, { symbol: null })}</span>
                  <span className={`inline-flex w-24 items-center justify-end gap-1 font-mono text-[11px] ${p.status === "Completed" ? "text-ok" : p.status === "Failed" ? "text-warn" : "text-muted"}`}>
                    {p.status === "Completed" ? <Check aria-hidden className="size-3.5" /> : p.status === "Failed" ? <ArrowDownLeft aria-hidden className="size-3.5" /> : <CircleDashed aria-hidden className="size-3.5" />}
                    {p.status === "Completed" ? "paid" : p.status === "Failed" ? "returned" : (p.status?.toLowerCase() ?? "pending")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {exec && !dev && (
                <a href={txUrl(exec)} target="_blank" rel="noreferrer" className="key key-ghost h-8 px-3 text-xs">
                  execute_basket <ExternalLink aria-hidden className="size-3" />
                </a>
              )}
              {r.bundle?.chain.approve_tx && !dev && (
                <a href={txUrl(r.bundle.chain.approve_tx)} target="_blank" rel="noreferrer" className="key key-ghost h-8 px-3 text-xs">
                  approve_basket <ExternalLink aria-hidden className="size-3" />
                </a>
              )}
              {r.bundle && (
                <button onClick={download} className="key key-ghost h-8 px-3 text-xs">
                  <Download aria-hidden className="size-3.5" /> Evidence JSON
                </button>
              )}
            </div>
            {r.bundle && (
              <dl className="mt-4 space-y-2 font-mono text-[11px]">
                {[
                  ["basket id", r.basket_id],
                  ["basket hash", r.hash],
                  ["evidence hash", r.bundle.evidence_hash],
                  ["rules hash", r.bundle.core.rules.rules_hash],
                ].map(([k, v]) =>
                  v ? (
                    <div key={k}>
                      <dt className="flex items-center justify-between text-faint">
                        {k}
                        <button onClick={() => copy(k!, v)} className="flex items-center gap-1 text-muted hover:text-fg">
                          {copied === k ? <Check aria-hidden className="size-3 text-accent" /> : <Copy aria-hidden className="size-3" />}
                          {copied === k ? "copied" : "copy"}
                        </button>
                      </dt>
                      <dd className="break-all text-fg">{v}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
          </div>

          <div className={`rounded-2xl p-4 ring-1 ring-inset ${r.ok ? "ring-line" : "bg-bad-soft ring-bad/40"}`}>
            <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-muted uppercase">
              <FileSearch aria-hidden className="size-3.5" /> Checked in your browser
            </p>
            {r.bundle ? (
              <ul className="mt-3 space-y-2">
                {r.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2 text-[12.5px]">
                    {c.status === "PASS" ? (
                      <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    ) : c.status === "SKIP" ? (
                      <CircleDashed aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />
                    ) : (
                      <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-bad" />
                    )}
                    <span className="min-w-0">
                      <span className={c.status === "FAIL" ? "text-bad" : c.status === "SKIP" ? "text-muted" : "text-fg"}>{c.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-faint" title={c.detail}>
                        {c.status === "SKIP" ? `skipped: ${c.detail}` : c.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-bad">The evidence bundle couldn&apos;t be fetched, so nothing here is verified. {r.bundleError}</p>
            )}
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-faint">
              <Terminal aria-hidden className="size-3.5" /> pnpm verify:audit {r.basket_id.slice(0, 8)}… runs the same checks
            </p>
          </div>
        </div>
      )}
    </li>
  );
}
