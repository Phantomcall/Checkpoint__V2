import {
  DEFAULT_RULES_CONFIG,
  basketHash,
  encodePayload,
  evidenceHashHex,
  fromHex,
  keyPairFromSeed,
  replayRequest,
  rulesHashHex,
  sha256,
  signBasketHash,
  toBase58,
  toBase64,
  toHex,
  utf8ToBytes,
  type AgentEvent,
  type AgentEventData,
  type AgentEventType,
  type CatalogItem,
  type Constraints,
  type EvidenceBundle,
  type EvidenceCore,
  type Finding,
  type ItemRequest,
  type Offer,
  type Unmatched,
  type Verdict,
} from "@checkpoint/shared";
import catalogJson from "../../../../../data/snapshot/catalog.json";
import fixturesJson from "../../../../../data/snapshot/fixtures/adversarial.json";
import offersJson from "../../../../../data/snapshot/offers.json";
import { config } from "../config";
import { dryQuote } from "../intents";
import { assessBasket, assessOffers, parseDeterministic, planBasket, templateBasket, templateVerdict } from "./engine";
import type { AgentsClient, RequestSummary } from "./types";

/**
 * In-browser stand-in for the agents service (NEXT_PUBLIC_USE_MOCK=1), for a deployed demo with no service
 * behind it. It is not a reimplementation: it calls the same parser, Guard rules, Coordinator, payload
 * encoder and evidence hash as the services (./engine), over the frozen snapshot plus fixtures, and signs
 * with the published dev Guard key that `pnpm mock` uses. What it fakes is the chain: the Vault views are
 * the PRD §7.1 defaults, approval comes from a stand-in wallet, and vendor-06's payout fails (AT-10), like
 * MockChain. Events are stored with due times in localStorage, so a refresh replays the log and the run
 * carries on, like the SSE stream with Last-Event-ID.
 */

const CATALOG = catalogJson.items as unknown as CatalogItem[];
const OFFERS = [...(offersJson.offers as unknown as Offer[]), ...(fixturesJson.offers as unknown as Offer[])];
const VENDORS = ["01", "02", "03", "04", "06"].map((n) => `vendor-${n}.cpdemo.testnet`);
const FAILING = ["vendor-06.cpdemo.testnet"];
const RULES = DEFAULT_RULES_CONFIG;
const RULES_HASH = rulesHashHex(RULES);
const AGENT = "agent.cpdemo.testnet";
const KEY = keyPairFromSeed(sha256(utf8ToBytes("checkpoint/mock-guard-key")));
const TTL_MS = 15 * 60_000;
const VAULT = { max_basket: 500_000_000n, daily_cap: 1_000_000_000n, available: 1_000_000_000n, max_vendors: 4 };

const RUNS = "cp-mock-runs-v2";
const BUNDLES = "cp-mock-bundles-v2";

interface Stored {
  seq: number;
  due: number;
  type: AgentEventType;
  data: unknown;
}
interface Run {
  id: string;
  owner: string;
  created: number;
  events: Stored[];
  acks: string[];
}

const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "") as T;
  } catch {
    return d;
  }
};
const runs = () => read<Record<string, Run>>(RUNS, {});
const bundles = () => read<Record<string, EvidenceBundle>>(BUNDLES, {});
const bus = new EventTarget();

function commit(all: Record<string, Run>, id: string) {
  localStorage.setItem(RUNS, JSON.stringify(all));
  bus.dispatchEvent(new CustomEvent("append", { detail: id }));
}
function putBundle(b: EvidenceBundle) {
  localStorage.setItem(BUNDLES, JSON.stringify({ ...bundles(), [b.core.basket.basket_id]: b }));
}

function push<T extends AgentEventType>(run: Run, due: number, type: T, data: AgentEventData<T>) {
  run.events.push({ seq: run.events.length + 1, due, type, data });
}
/** Drop events that haven't been delivered yet (a pending expiry, or a superseded plan). */
const dropFuture = (run: Run, now: number) => (run.events = run.events.filter((e) => e.due <= now));
const delivered = (run: Run, now = Date.now()) =>
  run.events.filter((e) => e.due <= now).map((e) => ({ seq: e.seq, ts: new Date(e.due).toISOString(), type: e.type, data: e.data }) as AgentEvent);

const fakeTx = () => toBase58(crypto.getRandomValues(new Uint8Array(32)));

interface Ctx {
  text: string;
  constraints: Constraints;
  items: ItemRequest[];
  unmatched: Unmatched[];
  offers: Offer[];
  verdicts: Record<string, Verdict>;
}

function pipeline(run: Run, text: string, constraints: Constraints) {
  let t = run.created;
  push(run, t, "request.created", { request_id: run.id, owner_id: run.owner, text, constraints });
  const parsed = parseDeterministic(text, CATALOG);
  push(run, (t += 700), "research.parsed", { items: parsed.items, parser: "deterministic" });
  if (parsed.unmatched.length) push(run, (t += 200), "research.unmatched", { unmatched: parsed.unmatched });
  if (!parsed.items.length) return push(run, (t += 300), "error", { code: "NO_ITEMS", message: "Nothing in the list matches the catalogue.", recoverable: false });

  const keys = new Set(parsed.items.map((i) => i.item_key));
  const offers = OFFERS.filter((o) => keys.has(o.item_key));
  for (const offer of offers) push(run, (t += 120), "research.offer", { offer });

  const assessed = assessOffers({ offers: OFFERS, catalog: CATALOG, offerIds: offers.map((o) => o.offer_id), config: RULES, rulesHash: RULES_HASH, allowedVendors: VENDORS, nowMs: Date.now() });
  t += 400;
  for (const v of assessed.verdicts) push(run, (t += 110), "policy.verdict", { verdict: v, median_micro: assessed.medians[v.item_key] ?? null });
  for (const v of assessed.verdicts) push(run, (t += 30), "explain.verdict", { offer_id: v.offer_id, text: templateVerdict(v), source: "template", advisory: true });

  const verdicts = Object.fromEntries(assessed.verdicts.map((v) => [v.offer_id, v]));
  planAndSign(run, t + 500, { text, constraints, items: parsed.items, unmatched: parsed.unmatched, offers, verdicts });
}

function ctxOf(run: Run): Ctx {
  const v = replayRequest(run.events.map((e) => ({ seq: e.seq, ts: new Date(e.due).toISOString(), type: e.type, data: e.data }) as AgentEvent));
  return { text: v.text, constraints: v.constraints, items: v.items, unmatched: v.unmatched, offers: v.offers, verdicts: v.verdicts };
}

/** The orchestrator's planAndSign step, with Guard's /sign-basket checks done in place. */
function planAndSign(run: Run, t: number, c: Ctx) {
  const basketId = crypto.randomUUID();
  const plan = planBasket({
    request_id: run.id,
    basket_id: basketId,
    owner_id: run.owner,
    token_id: config.tokenId,
    items: c.items,
    offers: c.offers,
    verdicts: c.verdicts,
    acknowledged_offer_ids: run.acks,
    ...(c.constraints.preferred_vendors ? { preferred_vendors: c.constraints.preferred_vendors } : {}),
    max_vendors: VAULT.max_vendors,
    rate: RULES.usd_to_token,
  });
  if (!plan.ok) return push(run, t, "error", { code: plan.code, message: plan.message, recoverable: false });
  if (plan.unfilled.length) push(run, t, "error", { code: "NO_ELIGIBLE_OFFER", message: `No offer passed the rules for: ${plan.unfilled.join(", ")}. They are left out of the basket.`, recoverable: true });
  if (c.constraints.max_total && BigInt(plan.basket.total) > BigInt(c.constraints.max_total))
    return push(run, t, "error", { code: "OVER_OWNER_BUDGET", message: "The cheapest allowed basket costs more than your max total.", recoverable: false });

  const byId = (a: { offer_id: string }, b: { offer_id: string }) => (a.offer_id < b.offer_id ? -1 : a.offer_id > b.offer_id ? 1 : 0);
  const core: EvidenceCore = {
    schema: "checkpoint-evidence-v1",
    request: { request_id: run.id, owner_id: run.owner, text: c.text, constraints: c.constraints, items: c.items, unmatched: c.unmatched },
    offers: [...c.offers].sort(byId),
    verdicts: Object.values(c.verdicts).sort(byId),
    rules: { config: RULES, rules_hash: RULES_HASH },
    acknowledged_offer_ids: run.acks,
    basket: plan.basket,
  };
  const evidenceHash = evidenceHashHex(core);
  const bundle: EvidenceBundle = { core, evidence_hash: evidenceHash, signed: null, chain: { approve_tx: null, execute_tx: null, payouts: [], final_status: null } };
  push(run, t, "coordinator.basket", { basket: { ...plan.basket, evidence_hash: evidenceHash }, acknowledged_offer_ids: run.acks });

  if (plan.needs_ack.length) {
    putBundle(bundle);
    return push(run, t + 250, "coordinator.needs_ack", {
      offer_ids: plan.needs_ack,
      reasons: plan.needs_ack.map((oid) => ({ offer_id: oid, findings: c.verdicts[oid]!.findings.filter((f) => f.level === "REVIEW") })),
    });
  }

  // Guard: basket rules R-20..R-24 against the mock Vault's limits, then build, hash and sign the payload.
  const acks = new Set(run.acks);
  const blocked = assessBasket({
    token_id: config.tokenId,
    total: BigInt(plan.basket.total),
    vendor_count: plan.basket.payouts.length,
    lines: plan.basket.lines.map((l) => ({ offer_id: l.offer_id, level: l.level })),
    acknowledged_offer_ids: acks,
    vault: { tokens: [config.tokenId], effective_max_basket: VAULT.max_basket, effective_daily_cap: VAULT.daily_cap, spent_today: 0n, max_vendors: VAULT.max_vendors, available: VAULT.available },
    decimals: RULES.usd_to_token.decimals,
  });
  if (blocked.length) {
    putBundle(bundle);
    return push(run, t + 600, "guard.refused", { code: "GUARD_REFUSED", message: "Guard will not sign this basket.", findings: blocked });
  }
  const created = BigInt(Date.now() > t ? Date.now() : t);
  const payload = {
    schema_version: 1,
    network_id: config.network,
    vault_id: config.vaultId,
    policy_version: 1,
    rules_hash: fromHex(RULES_HASH),
    guard_key_version: 1,
    basket_id: basketId,
    owner_id: run.owner,
    agent_id: AGENT,
    token_id: config.tokenId,
    payouts: plan.basket.payouts.map((p) => ({ vendor_id: p.vendor_id, amount: BigInt(p.amount), line_count: p.line_count })),
    total: BigInt(plan.basket.total),
    evidence_hash: fromHex(evidenceHash),
    nonce: new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0),
    created_at_ms: created,
    expires_at_ms: created + BigInt(TTL_MS),
  };
  const bytes = encodePayload(payload);
  const hash = basketHash(bytes);
  const signed = { payload_b64: toBase64(bytes), hash_hex: toHex(hash), signature_b64: toBase64(signBasketHash(hash, KEY.seed)), guard_key_version: 1, expires_at_ms: Number(payload.expires_at_ms) };
  const reviewed: Finding[] = plan.basket.lines
    .filter((l) => l.level === "REVIEW" && acks.has(l.offer_id))
    .flatMap((l) => c.verdicts[l.offer_id]!.findings.filter((f) => f.level === "REVIEW").map((f) => ({ ...f, inputs: { ...f.inputs, offer_id: l.offer_id } })));
  putBundle({ ...bundle, signed });
  push(run, t + 700, "guard.signed", { signed, basket_id: basketId, payouts: plan.basket.payouts, total: plan.basket.total, findings: reviewed });
  push(run, t + 800, "explain.basket", { text: templateBasket({ ...plan.basket, evidence_hash: evidenceHash }), source: "template", advisory: true });
  push(run, t + 900, "approval.waiting", { hash_hex: signed.hash_hex, expires_at_ms: signed.expires_at_ms });
  push(run, signed.expires_at_ms, "approval.expired", { hash_hex: signed.hash_hex });
}

function settle(run: Run, hashHex: string) {
  const v = ctxOfSigned(run);
  if (!v || v.hash_hex !== hashHex) throw new Error("That basket is no longer the one waiting for approval.");
  const now = Date.now();
  dropFuture(run, now);
  const approveTx = fakeTx();
  const executeTx = fakeTx();
  let t = now + 400;
  push(run, t, "approval.seen", { hash_hex: hashHex, owner_id: run.owner });
  push(run, (t += 1400), "settlement.submitted", { hash_hex: hashHex, tx_hash: executeTx });
  const payouts = v.payouts.map((p, index) => ({ index, vendor_id: p.vendor_id, amount: p.amount, status: FAILING.includes(p.vendor_id) ? ("Failed" as const) : ("Completed" as const), tx_hash: executeTx }));
  for (const p of payouts) push(run, (t += 1000), "settlement.payout", p);
  const ok = payouts.filter((p) => p.status === "Completed").length;
  const status = ok === payouts.length ? "Completed" : ok === 0 ? "Failed" : "PartiallyPaid";
  push(run, t + 800, "settlement.final", { hash_hex: hashHex, status });
  const b = bundles()[v.basket_id];
  if (b) putBundle({ ...b, chain: { approve_tx: approveTx, execute_tx: executeTx, payouts: payouts.map(({ tx_hash: _, ...p }) => p), final_status: status } });
}

function ctxOfSigned(run: Run) {
  const last = [...run.events].reverse().find((e) => e.type === "guard.signed" || e.type === "coordinator.basket");
  if (last?.type !== "guard.signed") return null;
  const d = last.data as AgentEventData<"guard.signed">;
  return { hash_hex: d.signed.hash_hex, basket_id: d.basket_id, payouts: d.payouts };
}

function must(id: string) {
  const all = runs();
  const run = all[id];
  if (!run) throw new Error("This request isn't stored in this browser. Mock mode keeps requests locally.");
  return { all, run };
}

export const mockClient: AgentsClient = {
  mode: "mock",
  async catalog() {
    return CATALOG;
  },
  async createRequest({ owner_id, text, constraints }) {
    const all = runs();
    const id = crypto.randomUUID();
    const run: Run = { id, owner: owner_id, created: Date.now(), events: [], acks: [] };
    pipeline(run, text, constraints ?? {});
    all[id] = run;
    commit(all, id);
    return { request_id: id };
  },
  async listRequests(ownerId) {
    return Object.values(runs())
      .filter((r) => r.owner === ownerId)
      .sort((a, b) => b.created - a.created)
      .slice(0, 20)
      .map((r): RequestSummary => {
        const v = replayRequest(delivered(r));
        return { request_id: r.id, created_at: new Date(r.created).toISOString(), text: v.text, state: v.state, total: v.basket?.total ?? null };
      });
  },
  async requestView(id) {
    return replayRequest(delivered(must(id).run));
  },
  subscribe(id, onEvent, onError) {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pump = () => {
      clearTimeout(timer);
      const run = runs()[id];
      if (!run) return onError?.("This request isn't stored in this browser. Mock mode keeps requests locally.");
      const now = Date.now();
      for (const e of run.events) {
        if (e.seq <= last) continue;
        if (e.due > now) {
          timer = setTimeout(pump, Math.min(e.due - now, 2 ** 31 - 1));
          break;
        }
        last = e.seq;
        onEvent({ seq: e.seq, ts: new Date(e.due).toISOString(), type: e.type, data: e.data } as AgentEvent);
      }
    };
    const onAppend = (ev: Event) => (ev as CustomEvent<string>).detail === id && pump();
    bus.addEventListener("append", onAppend);
    pump();
    return () => {
      bus.removeEventListener("append", onAppend);
      clearTimeout(timer);
    };
  },
  async acknowledge(id, offerIds) {
    const { all, run } = must(id);
    const v = replayRequest(delivered(run));
    if (!["assessed", "needs_ack", "signed", "awaiting_approval"].includes(v.state)) throw new Error(`Can't acknowledge while the request is ${v.state}.`);
    for (const oid of offerIds) if (v.verdicts[oid]?.level !== "REVIEW") throw new Error(`Only offers with a REVIEW verdict can be acknowledged (${oid}).`);
    const now = Date.now();
    dropFuture(run, now);
    run.acks = [...new Set([...run.acks, ...offerIds])].sort();
    planAndSign(run, now + 300, ctxOf(run));
    commit(all, id);
  },
  async cancel(id) {
    const { all, run } = must(id);
    const v = replayRequest(delivered(run));
    if (["executing", "final", "refused", "expired", "cancelled"].includes(v.state)) throw new Error(`Can't cancel while the request is ${v.state}.`);
    const now = Date.now();
    dropFuture(run, now);
    push(run, now, "error", {
      code: "CANCELLED",
      message: v.state === "awaiting_approval" ? "Cancelled. If you already approved this basket in your wallet, revoke the approval (revoke_approval)." : "Cancelled.",
      recoverable: false,
    });
    commit(all, id);
  },
  async audit(basketId) {
    const b = bundles()[basketId];
    if (!b) throw new Error(`No evidence bundle for basket ${basketId} in this browser.`);
    return b;
  },
  async intentsQuote(_id, total) {
    return dryQuote(total);
  },
  async guardPubkey() {
    return toBase58(KEY.publicKey);
  },
  async hasDevWallet() {
    return true;
  },
  async devApprove(hashHex, _owner, _expires, requestId) {
    const { all, run } = must(requestId);
    const state = replayRequest(delivered(run)).state;
    if (state !== "awaiting_approval") throw new Error(`Nothing to approve while the request is ${state}.`);
    settle(run, hashHex);
    commit(all, requestId);
  },
};

