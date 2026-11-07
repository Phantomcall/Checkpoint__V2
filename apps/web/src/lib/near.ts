import { JsonRpcProvider } from "near-api-js";
import { VaultApprovalViewSchema, VaultBalanceViewSchema, VaultBasketViewSchema, VaultOwnerStateViewSchema, VaultPolicyViewSchema } from "@checkpoint/shared";
import { config } from "./config";

/**
 * Read-only chain access. Every balance, approval and policy the UI shows comes through here,
 * straight from RPC. The web app never asserts chain state itself (PRD §6.1).
 */
let provider: JsonRpcProvider | null = null;
export function rpc(): JsonRpcProvider {
  provider ??= new JsonRpcProvider({ url: config.rpcUrl });
  return provider;
}

/** Calls a view method and returns its JSON result. Throws with the RPC/contract message on failure. */
export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await rpc().callFunction<T & {}>({ contractId, method, args, blockQuery: { finality: "final" } });
  return res as T;
}

/** True once the account holds contract code. A missing account, or one with no code (the all-ones hash), is false. */
export async function hasContract(accountId: string) {
  try {
    const a = await rpc().viewAccount({ accountId, blockQuery: { finality: "final" } });
    return !/^1+$/.test(a.code_hash);
  } catch {
    return false;
  }
}

/**
 * Re-reads a view until `done(result)` is true or the timeout passes. Used after transactions
 * instead of optimistic updates, so the chain stays the source of truth (P-1.2).
 */
export async function pollView<T>(read: () => Promise<T>, done: (v: T) => boolean, { timeoutMs = 10_000, everyMs = 1_000 } = {}): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last = await read();
  while (!done(last) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, everyMs));
    last = await read();
  }
  return last;
}

// ── Typed views (shapes follow PRD §10.1 / §11.1; adjust once Isaac's contract lands, in this file only) ──

export type U128 = string;

export interface StorageBalance {
  total: U128;
  available: U128;
}

export const ft = {
  balanceOf: (token: string, accountId: string) => view<U128>(token, "ft_balance_of", { account_id: accountId }),
  storageBalanceOf: (token: string, accountId: string) => view<StorageBalance | null>(token, "storage_balance_of", { account_id: accountId }),
  metadata: (token: string) => view<{ symbol: string; decimals: number; name: string }>(token, "ft_metadata"),
};

/**
 * Vault views, parsed with the same schemas Guard and the agents use (@checkpoint/shared vault-views,
 * docs/api.md "Vault views"). If the contract returns another shape, the parse fails loudly here instead
 * of a page rendering wrong numbers; the fix goes in packages/shared, once, for every reader.
 */
export const vault = {
  policy: async () => VaultPolicyViewSchema.parse(await view(config.vaultId, "get_policy")),
  ownerState: async (ownerId: string) => VaultOwnerStateViewSchema.parse(await view(config.vaultId, "get_owner_state", { owner_id: ownerId })),
  balance: async (ownerId: string, tokenId = config.tokenId) => VaultBalanceViewSchema.parse(await view(config.vaultId, "get_balance", { owner_id: ownerId, token_id: tokenId })),
  approval: async (hashHex: string) => VaultApprovalViewSchema.nullable().parse(await view(config.vaultId, "get_approval", { hash_hex: hashHex })),
  basket: async (hashHex: string) => VaultBasketViewSchema.nullable().parse(await view(config.vaultId, "get_basket", { hash_hex: hashHex })),
  /** Newest first (PRD FR-UI05). */
  baskets: async (ownerId: string, fromIndex = 0, limit = 20) =>
    VaultBasketViewSchema.array().parse(await view(config.vaultId, "get_baskets", { owner_id: ownerId, from_index: fromIndex, limit })),
};

export type { VaultBalanceView, VaultBasketView, VaultOwnerStateView, VaultPolicyView } from "@checkpoint/shared";
