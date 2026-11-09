/**
 * The agents contract as the web app consumes it. Every shape comes from @checkpoint/shared, the same Zod
 * schemas the agents service validates against (docs/api.md), so a contract change breaks the web build
 * instead of the demo. Only the client interface below is web-specific.
 */
import type { AgentEvent, CatalogItem, CreateRequest, RequestState, RequestView } from "@checkpoint/shared";
import type { IntentsQuoteResponse } from "../intents";

export type {
  AgentEvent,
  AgentEventData,
  AgentEventType,
  BasketDraft,
  BasketLine,
  CatalogItem,
  Constraints,
  CreateRequest,
  EvidenceBundle,
  Finding,
  ItemRequest,
  Level,
  Offer,
  RequestState,
  RequestView,
  Unmatched,
  Verdict,
} from "@checkpoint/shared";

/** GET /v1/requests?owner_id= (Desk history). */
export interface RequestSummary {
  request_id: string;
  created_at: string;
  text: string;
  state: RequestState;
  total: string | null;
}

export interface AgentsClient {
  /** "mock" is the in-browser pipeline (NEXT_PUBLIC_USE_MOCK=1); "live" is an agents service over HTTP. */
  readonly mode: "live" | "mock";
  catalog(): Promise<CatalogItem[]>;
  createRequest(input: CreateRequest): Promise<{ request_id: string }>;
  listRequests(ownerId: string): Promise<RequestSummary[]>;
  /** GET /v1/requests/:id: the view the service derives with the shared reducer. */
  requestView(id: string): Promise<RequestView>;
  subscribe(id: string, onEvent: (e: AgentEvent) => void, onError?: (msg: string | null) => void): () => void;
  acknowledge(id: string, offerIds: string[]): Promise<void>;
  cancel(id: string): Promise<void>;
  audit(basketId: string): Promise<unknown>;
  /**
   * A dry NEAR Intents 1Click quote for the basket total (D-6.2): what it would cost from wNEAR. Advisory only.
   * Null when the service has quotes switched off.
   */
  intentsQuote(requestId: string, basketTotal: string): Promise<IntentsQuoteResponse | null>;
  /** Guard's ed25519 public key (base58), so the browser can check the signature too. Null when unknown. */
  guardPubkey(): Promise<string | null>;
  /**
   * A stand-in wallet for keyless runs: true for the in-browser mock and for `pnpm mock`, which exposes
   * /v1/dev/approve. Never true against real services; there the owner approves from their own wallet.
   */
  hasDevWallet(): Promise<boolean>;
  devApprove(hashHex: string, ownerId: string, expiresAtMs: number, requestId: string): Promise<void>;
}
