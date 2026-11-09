import {
  AGENT_EVENT_TYPES,
  AgentEventSchema,
  CatalogResponseSchema,
  CreateRequestResponseSchema,
  keyPairFromSeed,
  sha256,
  toBase58,
  utf8ToBytes,
} from "@checkpoint/shared";
import { config } from "../config";
import type { IntentsQuoteResponse } from "../intents";
import { vault } from "../near";
import { mockClient } from "./mock";
import type { AgentsClient, RequestSummary } from "./types";

/** The fixed, published Guard key that `pnpm mock` and the in-browser mock sign with. Never on a real Vault. */
export const DEV_GUARD_PUBKEY = toBase58(keyPairFromSeed(sha256(utf8ToBytes("checkpoint/mock-guard-key"))).publicKey);

const url = (path: string) => `${config.agentsUrl}${path}`;

/** Errors from the service come back as { code, message }; show the message, keep the code for the toast. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url(path), init && { ...init, headers: { "content-type": "application/json", ...init.headers } });
  } catch {
    throw new Error(`Couldn't reach the agents service at ${config.agentsUrl}. Is it running? (pnpm mock)`);
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(body?.message ?? `The agents service answered ${r.status}.`), { code: body?.code });
  return body as T;
}

let dev: Promise<boolean> | null = null;

/** The agents service over HTTP (docs/api.md). Every call goes through here; components never build URLs. */
const live: AgentsClient = {
  mode: "live",
  async catalog() {
    return CatalogResponseSchema.parse(await call("/v1/catalog")).items;
  },
  async createRequest(input) {
    return CreateRequestResponseSchema.parse(await call("/v1/requests", { method: "POST", body: JSON.stringify(input) }));
  },
  async listRequests(ownerId) {
    return (await call<{ requests: RequestSummary[] }>(`/v1/requests?owner_id=${encodeURIComponent(ownerId)}`)).requests;
  },
  async requestView(id) {
    return call(`/v1/requests/${id}`);
  },
  subscribe(id, onEvent, onError) {
    // Named events only, so onmessage never fires. A fresh connection replays the whole log, and the browser
    // resends Last-Event-ID on reconnect; the reducer drops anything it has already seen.
    const es = new EventSource(url(`/v1/requests/${id}/events`));
    const handle = (m: MessageEvent<string>) => {
      onError?.(null);
      let raw: unknown;
      try {
        raw = JSON.parse(m.data);
      } catch {
        return onError?.("Received an event the app couldn't read.");
      }
      const e = AgentEventSchema.safeParse(raw);
      // A schema failure here is contract drift between the service and this build; say so instead of guessing.
      if (!e.success) return onError?.(`Contract drift on "${(raw as { type?: string }).type}": ${e.error.issues[0]?.path.join(".")} ${e.error.issues[0]?.message}`);
      onEvent(e.data);
    };
    for (const t of AGENT_EVENT_TYPES) es.addEventListener(t, handle as EventListener);
    es.onerror = () => onError?.("Lost the live connection to the agents service. Retrying…");
    return () => es.close();
  },
  async acknowledge(id, offerIds) {
    await call(`/v1/requests/${id}/acknowledge`, { method: "POST", body: JSON.stringify({ offer_ids: offerIds }) });
  },
  async cancel(id) {
    await call(`/v1/requests/${id}/cancel`, { method: "POST", body: "{}" });
  },
  async audit(basketId) {
    return call(`/v1/audit/${basketId}`);
  },
  async intentsQuote(id) {
    try {
      return await call<IntentsQuoteResponse>(`/v1/requests/${id}/intents-quote`);
    } catch (e) {
      // 501: the service runs with AGENTS_INTENTS=off; 404: a build from before D-6.2. Neither is an error here.
      if ((e as { code?: string }).code === "NOT_ENABLED" || /answered 404/.test((e as Error).message)) return null;
      throw e;
    }
  },
  async guardPubkey() {
    if (await this.hasDevWallet()) return DEV_GUARD_PUBKEY;
    try {
      const r = await fetch(`${config.guardUrl}/v1/policy`);
      if (r.ok) return ((await r.json()) as { guard_pubkey_b58: string }).guard_pubkey_b58;
    } catch {
      /* Guard is usually not exposed to browsers; fall back to the Vault, which is the authority anyway. */
    }
    try {
      return (await vault.policy()).guard_pubkey || null;
    } catch {
      return null;
    }
  },
  hasDevWallet() {
    dev ??= fetch(url("/v1/dev/state"))
      .then((r) => r.ok)
      .catch(() => false);
    return dev;
  },
  async devApprove(hashHex, ownerId, expiresAtMs) {
    await call(`/v1/dev/approve/${hashHex}`, { method: "POST", body: JSON.stringify({ owner_id: ownerId, expires_at_ms: expiresAtMs }) });
  },
};

export const agents: AgentsClient = config.useMock ? mockClient : live;
