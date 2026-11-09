import { initialRequestView, reduceRequest, type AgentEvent, type RequestView } from "@checkpoint/shared";

/**
 * The request page runs the shared reducer (the one the agents service uses for GET /v1/requests/:id), so
 * a refresh replays to the same view. On top of it the web keeps the event log and one lane per actor for
 * the timeline, with the time each lane last moved.
 */
export type LaneKey = "research" | "guard" | "coordinator" | "approval" | "settlement";
export interface Lane {
  status: "idle" | "active" | "done" | "failed";
  at?: string;
  detail?: string;
}

export interface DeskView extends RequestView {
  lanes: Record<LaneKey, Lane>;
  log: AgentEvent[];
}

const LANES: Record<LaneKey, Lane> = {
  research: { status: "active" },
  guard: { status: "idle" },
  coordinator: { status: "idle" },
  approval: { status: "idle" },
  settlement: { status: "idle" },
};

export const initialDesk = (): DeskView => ({ ...initialRequestView(), lanes: LANES, log: [] });

export function reduceDesk(s: DeskView, e: AgentEvent): DeskView {
  if (e.seq <= s.last_seq) return s;
  const v = reduceRequest(s, e);
  return { ...v, log: [...s.log, e], lanes: lanes(s.lanes, v, e) };
}

function lanes(prev: Record<LaneKey, Lane>, v: RequestView, e: AgentEvent): Record<LaneKey, Lane> {
  const l = { ...prev };
  const set = (k: LaneKey, x: Lane) => (l[k] = { ...l[k], ...x, at: x.at ?? e.ts });
  const verdicts = Object.values(v.verdicts);
  switch (e.type) {
    case "request.created":
      set("research", { status: "active", detail: "reading your list" });
      break;
    case "research.parsed":
      set("research", { status: "active", detail: `${e.data.items.length} items · ${e.data.parser} parser` });
      break;
    case "research.offer":
      set("research", { status: "active", detail: `${v.offers.length} offers found` });
      break;
    case "policy.verdict":
      if (l.research.status !== "done") set("research", { status: "done", detail: `${v.offers.length} offers` });
      set("guard", { status: "active", detail: `${verdicts.filter((x) => x.level === "BLOCK").length} blocked · ${verdicts.filter((x) => x.level === "REVIEW").length} flagged` });
      break;
    case "coordinator.basket":
      // A re-plan supersedes the old signature, so approval and settlement start again.
      set("guard", { status: "active", detail: "signing the basket" });
      set("coordinator", { status: "done", detail: `${e.data.basket.payouts.length} vendors · ${e.data.basket.lines.length} lines` });
      l.approval = { status: "idle" };
      l.settlement = { status: "idle" };
      break;
    case "coordinator.needs_ack":
      set("guard", { status: "done", detail: `${e.data.offer_ids.length} line(s) need you` });
      set("approval", { status: "active", detail: "needs your review" });
      break;
    case "guard.signed":
      set("guard", { status: "done", detail: `signed · key v${e.data.signed.guard_key_version}` });
      break;
    case "guard.refused":
      set("guard", { status: "failed", detail: e.data.code === "GUARD_UNAVAILABLE" ? "unavailable, nothing signed" : e.data.code });
      break;
    case "approval.waiting":
      set("approval", { status: "active", detail: "waiting for your wallet" });
      break;
    case "approval.seen":
      set("approval", { status: "done", detail: "approved on-chain" });
      set("settlement", { status: "active", detail: "submitting" });
      break;
    case "approval.expired":
      set("approval", { status: "failed", detail: "approval window closed" });
      break;
    case "settlement.submitted":
      set("settlement", { status: "active", detail: "execute_basket sent" });
      break;
    case "settlement.payout":
      set("settlement", { status: "active", detail: `${v.settlement.payouts.length} of ${v.signed?.payouts.length ?? "?"} payouts` });
      break;
    case "settlement.final":
      set("settlement", { status: e.data.status === "Failed" ? "failed" : "done", detail: e.data.status === "PartiallyPaid" ? "partially paid" : e.data.status.toLowerCase() });
      break;
    case "error": {
      if (e.data.recoverable) break;
      if (e.data.code === "GUARD_UNAVAILABLE") {
        if (l.research.status === "active") set("research", { status: "done", detail: `${v.offers.length} offers` });
        set("guard", { status: "failed", detail: "unavailable, nothing signed" });
        break;
      }
      const active = (Object.keys(l) as LaneKey[]).find((k) => l[k].status === "active") ?? "research";
      set(active, { status: "failed", detail: e.data.code === "CANCELLED" ? "cancelled" : e.data.code });
      break;
    }
  }
  return l;
}

export type Tone = "info" | "warn" | "ok" | "bad";

/**
 * Guard was down or couldn't reach the chain (AT-14). The agents report it either as an error event or, at signing,
 * as guard.refused with no findings. Either way Guard judged nothing, so the UI must not call it a refusal.
 */
export const guardUnavailable = (v: RequestView) => v.refusal?.code === "GUARD_UNAVAILABLE" || v.errors.some((e) => e.code === "GUARD_UNAVAILABLE");

/** One status pill for the whole request, from the shared state plus what it is waiting on. */
export function stageOf(v: RequestView): { label: string; tone: Tone } {
  switch (v.state) {
    case "created":
      return { label: "Reading your list", tone: "info" };
    case "parsed":
    case "researched":
      return { label: "Researching offers", tone: "info" };
    case "assessed":
      return v.basket ? { label: "Guard is signing", tone: "info" } : { label: "Guard is checking prices", tone: "info" };
    case "needs_ack":
      return { label: "Needs your review", tone: "warn" };
    case "signed":
    case "awaiting_approval":
      return { label: "Waiting for your approval", tone: "warn" };
    case "executing":
      return { label: "Vault is paying", tone: "info" };
    case "final":
      return v.settlement.final_status === "Completed"
        ? { label: "Settled", tone: "ok" }
        : v.settlement.final_status === "PartiallyPaid"
          ? { label: "Partially paid", tone: "warn" }
          : { label: "Payouts failed", tone: "bad" };
    case "refused":
      if (guardUnavailable(v)) return { label: "Guard unavailable", tone: "bad" };
      return v.refusal ? { label: "Refused by Guard", tone: "bad" } : { label: "Stopped", tone: "bad" };
    case "expired":
      return { label: "Approval window closed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
  }
}

/** Acknowledging re-plans and re-signs; the service accepts it only in these states. */
export const canAcknowledge = (v: RequestView) => ["assessed", "needs_ack", "signed", "awaiting_approval"].includes(v.state);
export const canCancel = (v: RequestView) => !["executing", "final", "refused", "expired", "cancelled"].includes(v.state);
