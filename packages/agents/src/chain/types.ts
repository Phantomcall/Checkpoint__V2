import type { VaultBasketView } from '@checkpoint/shared';

export interface ApprovalView {
  owner: string;
  expires_at_ms: number;
}

/** Read-only chain access the agents need (Vault views). */
export interface VaultChain {
  getApproval(hashHex: string): Promise<ApprovalView | null>;
  getBasket(hashHex: string): Promise<VaultBasketView | null>;
  getMaxVendors(): Promise<number>;
}

/**
 * Submits execute_basket with the Settlement Agent's function-call key.
 * Implemented in settlement.ts (task I-3.3, handoff H9).
 */
export interface Settlement {
  execute(payloadB64: string, signatureB64: string): Promise<{ tx_hash: string }>;
}

export class ChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainError';
  }
}
