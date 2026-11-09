"use client";

import { ArrowRight, Check, CircleSlash, Clock, Gavel, Landmark, Loader2, PauseCircle, RefreshCw, ShieldAlert, ThumbsDown, ThumbsUp, Users, Vote as VoteIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { TrustLabel } from "@/components/trust-label";
import { accountUrl, config, txUrl } from "@/lib/config";
import { canVote, dao, decodeArgs, kindName, nsToMs, voters, type DaoPolicy, type FunctionCallAction, type Proposal, type ProposalStatus } from "@/lib/dao";
import { humanError } from "@/lib/errors";
import { formatAmount, shortHash } from "@/lib/format";
import { pollView, rpc, vault, type VaultPolicyView } from "@/lib/near";
import { actProposal, txHash } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

async function exists(accountId: string) {
  try {
    await rpc().viewAccount({ accountId, blockQuery: { finality: "final" } });
    return true;
  } catch {
    return false;
  }
}

type Load<T> = { state: "loading" } | { state: "missing" } | { state: "error"; error: string } | { state: "ok"; data: T };

async function load<T>(accountId: string, read: () => Promise<T>): Promise<Load<T>> {
  if (!(await exists(accountId))) return { state: "missing" };
  try {
    return { state: "ok", data: await read() };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

interface Council {
  name: string;
  purpose: string;
  policy: DaoPolicy;
  proposals: Proposal[];
}

/** P-5.1: the Vault policy and the council's proposals, both read from chain; votes go through the voter's own wallet. */
export default function GovernancePage() {
  const { accountId, signIn, send } = useWallet();
  const [policy, setPolicy] = useState<Load<VaultPolicyView>>({ state: "loading" });
  const [council, setCouncil] = useState<Load<Council>>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string; tx?: string | null } | null>(null);

  const refresh = useCallback(async () => {
    setPolicy({ state: "loading" });
    setCouncil({ state: "loading" });
    const [p, c] = await Promise.all([
      load(config.vaultId, () => vault.policy()),
      load(config.daoId, async () => {
        const [cfg, pol, proposals] = await Promise.all([dao.config(), dao.policy(), dao.recent(10)]);
        return { name: cfg.name, purpose: cfg.purpose, policy: pol, proposals };
      }),
    ]);
    setPolicy(p);
    setCouncil(c);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function vote(p: Proposal, action: "VoteApprove" | "VoteReject") {
    if (!accountId) return void (await signIn());
    setBusy(`${p.id}:${action}`);
    setNote(null);
    try {
      const out = await send(actProposal(p.id, action, p.kind));
      // Show the vote only once the chain has it.
      const fresh = await pollView(() => dao.proposal(p.id), (x) => !!x.votes[accountId]);
      setCouncil((c) => (c.state === "ok" ? { ...c, data: { ...c.data, proposals: c.data.proposals.map((x) => (x.id === p.id ? fresh : x)) } } : c));
      setNote({ tone: "ok", text: `Your ${action === "VoteApprove" ? "approve" : "reject"} vote on #${p.id} is on chain.`, tx: txHash(out) });
    } catch (e) {
      setNote({ tone: "bad", text: humanError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Governance" title="The council owns the policy" accent="council" locks={["vault"]} intro="Caps, vendor and token allowlists, Guard keys and the rules hash change only through a proposal and a vote. The guardian can only pause.">
        <TrustLabel kind="onchain" />
        <button onClick={() => void refresh()} className="key key-ghost h-8 px-3 text-xs">
          <RefreshCw aria-hidden className={`size-3.5 ${policy.state === "loading" ? "animate-spin" : ""}`} /> Refresh
        </button>
      </PageHeader>

      {note && (
        <p role="status" className={`mb-5 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-[13px] ring-1 ring-inset ${note.tone === "ok" ? "bg-ok-soft text-ok ring-ok/30" : "bg-bad-soft text-bad ring-bad/30"}`}>
          {note.text}
          {note.tx && (
            <a href={txUrl(note.tx)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] underline underline-offset-4">
              {shortHash(note.tx)}
            </a>
          )}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-5">
          <PolicyPanel s={policy} />
          <CouncilPanel s={council} me={accountId} />
        </div>
        <ProposalsPanel s={council} policy={policy.state === "ok" ? policy.data : null} me={accountId} busy={busy} onVote={vote} onSignIn={signIn} />
      </div>
    </>
  );
}

/** How a policy change travels, shown while there are no proposals to list. */
const FLOW: { title: string; body: string }[] = [
  { title: "A member proposes", body: "A FunctionCall proposal on the council: set_limits, an allowlist change or a new Guard key." },
  { title: "The council votes", body: "Sputnik counts approvals until the threshold passes or the proposal period ends." },
  { title: "The DAO calls the Vault", body: "Only the DAO account can change the policy. A proposal outside the Vault's bounds fails here." },
  { title: "The policy version moves", body: "Baskets signed under the old version stop with ERR_POLICY_VERSION, so nothing slips through mid-change." },
];

function PolicyFlow() {
  return (
    <div className="mx-auto mt-2 max-w-xl border-t border-line pt-6">
      <p className="eyebrow">How a policy change works</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {FLOW.map(({ title, body }, i) => (
          <li key={title} className="rounded-2xl p-4 ring-1 ring-inset ring-line">
            <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
              <span className="grid size-6 place-items-center rounded-full font-mono text-[10px] text-accent ring-1 ring-inset ring-accent/40 tabular">{i + 1}</span>
              {title}
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-muted">{body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Missing({ Icon, title, children }: { Icon: typeof Landmark; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--color-fg)_6%,transparent)] text-muted">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="mt-3 text-sm text-fg">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Rows({ n }: { n: number }) {
  return (
    <div aria-busy className="mt-4 space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center justify-between">
          <span className="h-3 w-24 animate-pulse rounded bg-line" />
          <span className="h-3 w-28 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  );
}

function PolicyPanel({ s }: { s: Load<VaultPolicyView> }) {
  return (
    <section className="panel edge-light rounded-[var(--radius-card)] p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Vault policy</p>
        {s.state === "ok" && <span className="rounded-full px-2 py-0.5 font-mono text-[10.5px] text-accent ring-1 ring-inset ring-accent/30">v{s.data.policy_version}</span>}
      </div>
      {s.state === "loading" ? (
        <Rows n={7} />
      ) : s.state === "missing" ? (
        <Missing Icon={Landmark} title={`${config.vaultId} isn't on ${config.network} yet`}>
          The policy appears here, read from get_policy, once the Vault is deployed and initialised.
        </Missing>
      ) : s.state === "error" ? (
        <p role="alert" className="mt-4 text-[13px] text-bad">
          Couldn&apos;t read get_policy: {s.error}
        </p>
      ) : (
        <>
          {(s.data.paused || s.data.deficit) && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[12.5px] text-bad ring-1 ring-inset ring-bad/30">
              <PauseCircle aria-hidden className="size-4" /> {s.data.deficit ? "Deficit flagged: deposits and withdrawals are stopped." : "Paused by the guardian: no approvals or payments."}
            </p>
          )}
          <dl className="mt-4 space-y-2.5 text-[13px]">
            {[
              ["Max per basket", formatAmount(s.data.max_basket_total)],
              ["Daily cap", formatAmount(s.data.daily_cap)],
              ["Max vendors per basket", String(s.data.max_vendors)],
              ["Approval window", `${Math.round(Number(s.data.max_ttl_ms) / 60_000)} min`],
              ["Guard key", `v${s.data.guard_key_version}${s.data.guard_key_disabled ? " · disabled" : ""} · ${shortHash(s.data.guard_pubkey, 6)}`],
              ["Rules hash", shortHash(s.data.rules_hash, 8)],
              ["Guardian", s.data.guardian],
              ["DAO", s.data.dao_id],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate font-mono text-[12.5px] text-fg" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <p className="font-mono text-[10.5px] tracking-wider text-faint uppercase">Allowed vendors</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.data.vendors.map((v) => (
                <a key={v} href={accountUrl(v)} target="_blank" rel="noreferrer" className="rounded-full px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-inset ring-line hover:text-fg">
                  {v.split(".")[0]}
                </a>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10.5px] tracking-wider text-faint uppercase">Tokens</p>
            <p className="mt-1 font-mono text-[12px] text-fg">{s.data.tokens.join(", ")}</p>
          </div>
        </>
      )}
    </section>
  );
}

function CouncilPanel({ s, me }: { s: Load<Council>; me: string | null }) {
  return (
    <section className="panel rounded-[var(--radius-card)] p-5">
      <p className="eyebrow">Council</p>
      {s.state === "loading" ? (
        <Rows n={4} />
      ) : s.state === "missing" ? (
        <Missing Icon={Users} title={`${config.daoId} isn't on ${config.network} yet`}>
          The members, voting threshold and proposal period appear here once the DAO is created.
        </Missing>
      ) : s.state === "error" ? (
        <p role="alert" className="mt-4 text-[13px] text-bad">
          Couldn&apos;t read the DAO: {s.error}
        </p>
      ) : (
        <>
          <p className="mt-3 text-[14px] font-medium text-fg">{s.data.name}</p>
          {s.data.purpose && <p className="mt-0.5 text-[12.5px] text-muted">{s.data.purpose}</p>}
          <dl className="mt-4 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">Passes at</dt>
              <dd className="font-mono text-[12.5px] text-fg">
                {Array.isArray(s.data.policy.default_vote_policy.threshold) ? `${s.data.policy.default_vote_policy.threshold[0]}/${s.data.policy.default_vote_policy.threshold[1]} of a role` : `${s.data.policy.default_vote_policy.threshold} votes`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Voting period</dt>
              <dd className="font-mono text-[12.5px] text-fg">{Math.round(nsToMs(s.data.policy.proposal_period) / 86_400_000)} days</dd>
            </div>
          </dl>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {voters(s.data.policy).map((m) => (
              <li key={m} className={`rounded-full px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset ${m === me ? "bg-accent-soft text-accent ring-accent/35" : "text-muted ring-line"}`}>
                {m}
                {m === me ? " · you" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const STATUS: Record<ProposalStatus, string> = {
  InProgress: "text-info ring-info/30",
  Approved: "bg-ok-soft text-ok ring-ok/25",
  Rejected: "bg-bad-soft text-bad ring-bad/25",
  Removed: "text-muted ring-line",
  Expired: "text-muted ring-line",
  Moved: "text-muted ring-line",
  Failed: "bg-bad-soft text-bad ring-bad/25",
};

function ProposalsPanel({
  s,
  policy,
  me,
  busy,
  onVote,
  onSignIn,
}: {
  s: Load<Council>;
  policy: VaultPolicyView | null;
  me: string | null;
  busy: string | null;
  onVote: (p: Proposal, a: "VoteApprove" | "VoteReject") => void;
  onSignIn: () => void;
}) {
  return (
    <section className="panel rounded-[var(--radius-card)] p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Recent proposals</p>
        <a href={accountUrl(config.daoId)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted hover:text-fg">
          {config.daoId}
        </a>
      </div>
      {s.state === "loading" ? (
        <div aria-busy className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-line/60" />
          ))}
        </div>
      ) : s.state === "missing" ? (
        <>
          <Missing Icon={Gavel} title="No council to show yet">
            Proposals to change caps, vendors or the Guard key, and the council&apos;s votes on them, appear here once the DAO exists.
          </Missing>
          <PolicyFlow />
        </>
      ) : s.state === "error" ? (
        <p role="alert" className="mt-4 text-[13px] text-bad">
          Couldn&apos;t read proposals: {s.error}
        </p>
      ) : s.data.proposals.length === 0 ? (
        <Missing Icon={VoteIcon} title="No proposals yet">
          The first one is usually the Vault&apos;s initial policy.
        </Missing>
      ) : (
        <ul className="mt-4 space-y-3">
          {s.data.proposals.map((p) => (
            <ProposalCard key={p.id} p={p} dao={s.data.policy} vaultPolicy={policy} me={me} busy={busy} onVote={onVote} onSignIn={onSignIn} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalCard({
  p,
  dao: pol,
  vaultPolicy,
  me,
  busy,
  onVote,
  onSignIn,
}: {
  p: Proposal;
  dao: DaoPolicy;
  vaultPolicy: VaultPolicyView | null;
  me: string | null;
  busy: string | null;
  onVote: (p: Proposal, a: "VoteApprove" | "VoteReject") => void;
  onSignIn: () => void;
}) {
  const kind = kindName(p.kind);
  const call = kind === "FunctionCall" ? (p.kind as { FunctionCall: { receiver_id: string; actions: FunctionCallAction[] } }).FunctionCall : null;
  const tally = Object.values(p.vote_counts).reduce((t, [y, n]) => [t[0] + Number(y), t[1] + Number(n)], [0, 0]);
  const ends = nsToMs(p.submission_time) + nsToMs(pol.proposal_period);
  const open = p.status === "InProgress" && ends > Date.now();
  const mine = me ? p.votes[me] : undefined;
  const mayApprove = !!me && canVote(pol, me, p.kind, "VoteApprove");
  const mayReject = !!me && canVote(pol, me, p.kind, "VoteReject");

  return (
    <li className="rounded-2xl p-4 ring-1 ring-inset ring-line">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-faint">#{p.id}</span>
            <span className="font-mono text-[12px] text-fg">{call ? `${call.receiver_id.split(".")[0]}.${call.actions.map((a) => a.method_name).join(", ")}` : kind}</span>
          </p>
          <p className="mt-1 text-[13.5px] leading-snug text-fg">{p.description.split("$$$$")[0] || "No description"}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${STATUS[p.status]}`}>{p.status === "InProgress" && !open ? "Expired · not finalised" : p.status === "InProgress" ? "Voting" : p.status}</span>
      </div>

      {call?.actions.map((a, i) => {
        const args = decodeArgs(a.args) as Record<string, unknown> | null;
        // Before/after for Vault calls whose argument names match policy fields (e.g. set_limits).
        const diff = args && vaultPolicy && call.receiver_id === config.vaultId ? Object.entries(args).filter(([k]) => k in vaultPolicy) : [];
        return (
          <div key={i} className="mt-3">
            {diff.length > 0 ? (
              <table className="w-full font-mono text-[11.5px]">
                <tbody>
                  {diff.map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 text-faint">{k}</td>
                      <td className="py-0.5 text-right text-muted">{String(vaultPolicy![k as keyof VaultPolicyView])}</td>
                      <td className="w-6 text-center text-faint">
                        <ArrowRight aria-hidden className="inline size-3" />
                      </td>
                      <td className="py-0.5 text-fg">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              args && <pre className="max-h-32 overflow-auto rounded-xl bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] p-3 font-mono text-[11px] leading-relaxed text-muted ring-1 ring-line">{JSON.stringify(args, null, 2)}</pre>
            )}
          </div>
        );
      })}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-3 font-mono text-[11px] text-muted">
          <span className="flex items-center gap-1 text-ok">
            <ThumbsUp aria-hidden className="size-3" /> {tally[0]}
          </span>
          <span className="flex items-center gap-1 text-bad">
            <ThumbsDown aria-hidden className="size-3" /> {tally[1]}
          </span>
          <span className="flex items-center gap-1">
            <Clock aria-hidden className="size-3" />
            {open ? `ends ${new Date(ends).toLocaleDateString([], { day: "numeric", month: "short" })}` : new Date(nsToMs(p.submission_time)).toLocaleDateString([], { day: "numeric", month: "short" })}
          </span>
          <span className="truncate">by {p.proposer}</span>
        </p>
        {open &&
          (mine ? (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-accent ring-1 ring-inset ring-accent/30">
              <Check aria-hidden className="size-3" /> you voted {mine.toLowerCase()}
            </span>
          ) : !me ? (
            <button onClick={onSignIn} className="key key-ghost h-8 px-3 text-xs">
              Sign in to vote
            </button>
          ) : mayApprove || mayReject ? (
            <span className="flex gap-2">
              <button onClick={() => onVote(p, "VoteReject")} disabled={!mayReject || !!busy} className="key key-ghost h-8 px-3 text-xs text-bad">
                {busy === `${p.id}:VoteReject` ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <CircleSlash aria-hidden className="size-3.5" />} Reject
              </button>
              <button onClick={() => onVote(p, "VoteApprove")} disabled={!mayApprove || !!busy} className="key key-primary h-8 px-3 text-xs">
                {busy === `${p.id}:VoteApprove` ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Check aria-hidden className="size-3.5" />} Approve
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-1 font-mono text-[11px] text-faint">
              <ShieldAlert aria-hidden className="size-3" /> council members vote
            </span>
          ))}
      </div>
    </li>
  );
}
