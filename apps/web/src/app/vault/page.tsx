"use client";

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Bot, CircleDashed, Eye, Gauge, Hammer, Loader2, PauseCircle, RefreshCw, UserPlus, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Ghost, PageHeader } from "@/components/page-header";
import { TrustLabel } from "@/components/trust-label";
import { accountUrl, config, txUrl } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { formatAmount, parseAmount } from "@/lib/format";
import { ft, hasContract, pollView, vault, type VaultBalanceView, type VaultOwnerStateView, type VaultPolicyView } from "@/lib/near";
import { utcDayIndex } from "@checkpoint/shared";
import { deposit, isRegistered, setAgent, storageDeposit, storageMin, txHash, withdraw, type Tx } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const AGENT = "agent.cpdemo.testnet";
/** The account the demo deposits into. Anyone can read a Vault balance, so it can be shown without a wallet. */
const DEMO_OWNER = "owner-demo.cpdemo.testnet";

interface Data {
  vaultLive: boolean;
  tokenLive: boolean;
  registered: boolean;
  wallet: bigint;
  policy: VaultPolicyView | null;
  owner: VaultOwnerStateView | null;
  balance: VaultBalanceView | null;
}

/** FR-UI02 / P-1.2: every number here is read from chain; after each transaction we re-read rather than guess. */
function useVault(accountId: string | null) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!accountId) return null;
    setLoading(true);
    setError(null);
    try {
      const [vaultLive, tokenLive] = await Promise.all([hasContract(config.vaultId), hasContract(config.tokenId)]);
      const registered = tokenLive ? await isRegistered(accountId) : false;
      const wallet = tokenLive && registered ? BigInt(await ft.balanceOf(config.tokenId, accountId)) : 0n;
      const [policy, owner, balance] = vaultLive
        ? await Promise.all([vault.policy().catch(() => null), vault.ownerState(accountId).catch(() => null), vault.balance(accountId).catch(() => null)])
        : [null, null, null];
      const d = { vaultLive, tokenLive, registered, wallet, policy, owner, balance };
      setData(d);
      return d;
    } catch (e) {
      setError(humanError(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [accountId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export default function VaultPage() {
  const { ready, accountId, signIn, send } = useWallet();
  // Read-only view of another account (?view=<account>, or the demo owner), until a wallet signs in.
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => {
    setViewing(new URLSearchParams(location.search).get("view"));
  }, []);
  const shown = accountId ?? viewing;
  const readOnly = !accountId;
  const { data, error, loading, reload } = useVault(shown);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; tx?: string } | null>(null);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const bal = data?.balance;
  const available = BigInt(bal?.available ?? "0");
  const agentOn = !!data?.owner?.agents?.includes(AGENT);

  async function run(label: string, build: () => Promise<Tx> | Tx, until?: (d: Data | null) => boolean) {
    setBusy(label);
    setNote(null);
    try {
      const outcome = await send(await build());
      const tx = txHash(outcome) ?? undefined;
      if (until) await pollView(reload, until);
      else await reload();
      setNote({ tone: "ok", text: `${label}: done`, tx });
      setAmount("");
    } catch (e) {
      setNote({ tone: "bad", text: humanError(e) });
    } finally {
      setBusy(null);
    }
  }

  let parsed: bigint | null = null;
  let amountErr: string | null = null;
  if (amount.trim()) {
    try {
      parsed = parseAmount(amount);
      if (parsed === 0n) amountErr = "Enter more than zero";
      else if (tab === "deposit" && parsed > (data?.wallet ?? 0n)) amountErr = "More than your wallet holds";
      else if (tab === "withdraw" && parsed > available) amountErr = "More than your available balance";
    } catch (e) {
      amountErr = (e as Error).message;
    }
  }

  const header = (
    <PageHeader eyebrow="Vault · cpUSD" title="Your vault" intro="cpUSD held by the Vault contract. Agents can spend it only through baskets you approve, inside your caps.">
      <TrustLabel kind="onchain" />
      {shown && (
        <button onClick={() => reload()} aria-label="Refresh from chain" className="key key-ghost size-9">
          <RefreshCw aria-hidden className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      )}
    </PageHeader>
  );

  if (!shown) {
    return (
      <>
        {header}
        <StateCard Icon={Wallet} title="Sign in to see your vault" body="Balances, limits and agent access are read from NEAR for your account. Use a testnet wallet: Meteor, Intear or Nightly.">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setViewing(DEMO_OWNER)} className="key key-ghost h-11 px-5 text-sm">
              <Eye aria-hidden className="size-4" /> View the demo owner
            </button>
            <button onClick={() => signIn()} disabled={!ready} className="key key-primary h-11 px-5 text-sm">
              <Wallet aria-hidden className="size-4" /> Sign in
            </button>
          </div>
        </StateCard>
        <Skeleton />
      </>
    );
  }

  return (
    <>
      {header}
      {readOnly && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[13px] text-muted ring-1 ring-inset ring-line">
          <span className="flex items-center gap-2">
            <Eye aria-hidden className="size-4 text-accent" /> Read-only view of <span className="font-mono text-fg">{shown}</span>, straight from chain
          </span>
          <button onClick={() => signIn()} disabled={!ready} className="key key-primary h-8 px-3 text-xs">
            <Wallet aria-hidden className="size-3.5" /> Sign in for your own
          </button>
        </div>
      )}
      {error && <Banner tone="bad" Icon={AlertTriangle} text={error} />}
      {data && !data.vaultLive && (
        <StateCard Icon={Hammer} title="The Vault isn't on testnet yet" body={`${config.vaultId} hasn't been deployed yet. Until it is, this page can only read the token side.`}>
          <a href={accountUrl(config.vaultId)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline-offset-4 hover:underline">
            {config.vaultId}
          </a>
        </StateCard>
      )}
      {data?.policy?.paused && <Banner tone="bad" Icon={PauseCircle} text="The guardian has paused the Vault. Approvals and payments are stopped; withdrawals continue unless a deficit is flagged." />}
      {data?.policy?.deficit && <Banner tone="bad" Icon={AlertTriangle} text="The Vault found less cpUSD than it owes. Deposits and withdrawals are stopped until the DAO resolves it." />}

      {!data ? (
        <Skeleton />
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Tile label="Available" hint="Spendable by baskets you approve" value={bal ? formatAmount(bal.available, { symbol: null }) : null} accent />
            <Tile label="Reserved" hint="Locked for payouts in flight" value={bal ? formatAmount(bal.reserved, { symbol: null }) : null} />
            <Tile label="Withdrawing" hint="On its way back to your wallet" value={bal ? formatAmount(bal.withdrawing, { symbol: null }) : null} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="panel edge-light rounded-[var(--radius-card)] p-5">
              {readOnly ? (
                <div>
                  <p className="text-sm font-medium text-fg">Deposits and withdrawals need the owner&apos;s wallet</p>
                  <p className="mt-1 text-[13px] text-muted">
                    Only <span className="font-mono">{shown}</span> can move its cpUSD. {data.tokenLive && data.registered ? `Its wallet holds ${formatAmount(data.wallet)} outside the Vault.` : ""}
                  </p>
                  {data.policy && <Enforced policy={data.policy} />}
                </div>
              ) : !data.tokenLive ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <CircleDashed aria-hidden className="size-4" /> cpUSD isn&apos;t deployed yet ({config.tokenId}, handoff H4).
                </p>
              ) : !data.registered ? (
                <div>
                  <p className="text-sm font-medium text-fg">Register on cpUSD first</p>
                  <p className="mt-1 text-[13px] text-muted">NEP-145 storage: your account needs a small NEAR deposit on the token before it can hold cpUSD. Unused NEAR is refunded.</p>
                  <button
                    onClick={() => run("Register on cpUSD", async () => storageDeposit(accountId!, await storageMin()), (d) => !!d?.registered)}
                    disabled={!!busy}
                    className="key key-primary mt-4 h-10 px-5 text-sm"
                  >
                    {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserPlus aria-hidden className="size-4" />} Register on cpUSD
                  </button>
                </div>
              ) : (
                <>
                  <div role="tablist" className="inline-flex rounded-full border border-line p-1">
                    {(["deposit", "withdraw"] as const).map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => (setTab(t), setAmount(""))}
                        className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] capitalize transition-colors ${tab === t ? "bg-[color-mix(in_srgb,var(--color-fg)_9%,transparent)] text-fg" : "text-muted hover:text-fg"}`}
                      >
                        {t === "deposit" ? <ArrowDownToLine aria-hidden className="size-4" /> : <ArrowUpFromLine aria-hidden className="size-4" />} {t}
                      </button>
                    ))}
                  </div>
                  <label className="mt-5 block">
                    <span className="flex justify-between text-xs text-muted">
                      <span>Amount</span>
                      <span className="font-mono">
                        {tab === "deposit" ? `wallet ${formatAmount(data.wallet)}` : `available ${formatAmount(available)}`}
                      </span>
                    </span>
                    <span className="mt-2 flex items-center rounded-2xl border border-line bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] pr-2 focus-within:border-accent/50">
                      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-14 w-full bg-transparent px-4 font-mono text-2xl text-fg tabular placeholder:text-faint focus:outline-none" />
                      <button
                        onClick={() => setAmount(formatAmount(tab === "deposit" ? data.wallet : available, { symbol: null, shown: 6 }).replace(/,/g, ""))}
                        className="rounded-full px-3 py-1 font-mono text-[11px] text-accent ring-1 ring-inset ring-accent/30"
                      >
                        MAX
                      </button>
                    </span>
                    {amountErr && <span className="mt-1.5 block text-xs text-bad">{amountErr}</span>}
                  </label>
                  <button
                    disabled={!parsed || !!amountErr || !!busy || !data.vaultLive}
                    onClick={() =>
                      tab === "deposit"
                        ? run("Deposit", () => deposit(parsed!), (d) => BigInt(d?.balance?.available ?? "0") > available)
                        : run("Withdraw", () => withdraw(parsed!), (d) => BigInt(d?.balance?.available ?? "0") < available)
                    }
                    className="key key-primary mt-5 h-11 px-6 text-sm"
                  >
                    {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : tab === "deposit" ? <ArrowDownToLine aria-hidden className="size-4" /> : <ArrowUpFromLine aria-hidden className="size-4" />}
                    {tab === "deposit" ? "Deposit to Vault" : "Withdraw to wallet"}
                  </button>
                  <p className="mt-3 text-[11.5px] text-faint">
                    {tab === "deposit" ? "Sends ft_transfer_call to the Vault with 1 yocto." : "Calls withdraw on the Vault with 1 yocto; settles from the token callback."}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="panel rounded-[var(--radius-card)] p-5">
                <p className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Gauge aria-hidden className="size-4 text-accent" /> Limits today
                </p>
                {data.owner ? (
                  <Limits owner={data.owner} />
                ) : (
                  <p className="mt-3 text-[13px] text-muted">{data.vaultLive ? "No activity yet. Limits apply from your first deposit." : "Shown once the Vault is deployed."}</p>
                )}
              </div>
              <div className="panel rounded-[var(--radius-card)] p-5">
                <p className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Bot aria-hidden className="size-4 text-accent" /> Settlement agent
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-mono text-xs text-fg">{AGENT}</span>
                    <span className="block text-[11.5px] text-muted">Can call execute_basket for baskets you approve. Nothing else.</span>
                  </span>
                  <button
                    role="switch"
                    aria-checked={agentOn}
                    aria-label="Authorise settlement agent"
                    disabled={!data.vaultLive || !!busy || readOnly}
                    onClick={() => run(agentOn ? "Revoke agent" : "Authorise agent", () => setAgent(AGENT, !agentOn), (d) => !!d?.owner?.agents?.includes(AGENT) !== agentOn)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${agentOn ? "bg-accent" : "bg-line-strong"}`}
                  >
                    <span className={`absolute top-0.5 left-0 size-5 rounded-full bg-white shadow transition-transform ${agentOn ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {note && (
        <p role="status" className={`mt-4 text-sm ${note.tone === "ok" ? "text-ok" : "text-bad"}`}>
          {note.text}
          {note.tx && (
            <a href={txUrl(note.tx)} target="_blank" rel="noreferrer" className="ml-2 font-mono underline underline-offset-4">
              {note.tx.slice(0, 10)}…
            </a>
          )}
        </p>
      )}
    </>
  );
}

function Limits({ owner }: { owner: VaultOwnerStateView }) {
  const cap = BigInt(owner.daily_cap);
  // The Vault resets the day lazily: a stale day index means nothing is spent yet today.
  const spent = Number(owner.day) === utcDayIndex(Date.now()) ? BigInt(owner.spent_today) : 0n;
  const pct = cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0;
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between font-mono text-[12px]">
        <span className="text-muted">spent today</span>
        <span className="text-fg tabular">
          {formatAmount(spent, { symbol: null })} / {formatAmount(cap, { symbol: null })}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-fg)_7%,transparent)]">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-strong),var(--color-accent))]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted">max per basket {formatAmount(owner.max_basket)}</p>
    </div>
  );
}

/** What the Vault checks on every basket, read from get_policy. These hold whatever Guard or the agents say. */
function Enforced({ policy }: { policy: VaultPolicyView }) {
  const rows: [string, React.ReactNode][] = [
    ["Vendors", <span key="v" className="flex flex-wrap gap-1">{policy.vendors.map((v) => <span key={v} className="rounded-full px-2 py-0.5 ring-1 ring-inset ring-line">{v.split(".")[0]}</span>)}</span>],
    ["Token", policy.tokens.join(", ")],
    ["Per basket", formatAmount(policy.max_basket_total)],
    ["Per day", formatAmount(policy.daily_cap)],
    ["Vendors per basket", String(policy.max_vendors)],
    ["Rules hash", `${policy.rules_hash.slice(0, 16)}…`],
    ["Guard key", `v${policy.guard_key_version}${policy.guard_key_disabled ? " · disabled" : ""} · ${policy.guard_pubkey.slice(0, 10)}…`],
    ["Policy version", String(policy.policy_version)],
  ];
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="eyebrow">Enforced by the Vault on every basket</p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 font-mono text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Tile({ label, hint, value, accent }: { label: string; hint: string; value: string | null; accent?: boolean }) {
  return (
    <div className={`panel rounded-[var(--radius-card)] p-5 ${accent ? "edge-light" : ""}`}>
      <p className="eyebrow">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tabular ${value ? "text-fg" : "text-faint"}`}>
        {value ?? "—"} <span className="text-base font-normal text-muted">cpUSD</span>
      </p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </div>
  );
}

function StateCard({ Icon, title, body, children }: { Icon: typeof Wallet; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="panel edge-light flex flex-wrap items-center gap-5 rounded-[var(--radius-card)] p-6">
      <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent ring-1 ring-inset ring-accent/25">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{title}</p>
        <p className="mt-1 max-w-xl text-[13.5px] text-muted">{body}</p>
      </div>
      {children}
    </div>
  );
}

function Banner({ tone, Icon, text }: { tone: "bad" | "warn"; Icon: typeof Wallet; text: string }) {
  return (
    <p className={`mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px] ring-1 ring-inset ${tone === "bad" ? "bg-bad-soft text-bad ring-bad/30" : "bg-warn-soft text-warn ring-warn/30"}`}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 grid gap-4 opacity-60 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="panel rounded-[var(--radius-card)] p-5">
          <Ghost className="h-3 w-20" />
          <Ghost className="mt-4 h-8 w-32" />
          <Ghost className="mt-3 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
