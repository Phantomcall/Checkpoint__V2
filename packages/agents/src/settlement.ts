/**
 * Settlement Agent module (task I-3.3, handoff H9).
 *
 * Sends execute_basket(payload_b64, signature_b64) to the Vault with the
 * Settlement Agent's function-call key (AGENT_FC_PRIVATE_KEY: receiver VAULT_ID,
 * method execute_basket only, 1 NEAR allowance), 300 TGas and no deposit.
 * Returns the transaction hash. On failure it throws a ChainError whose message
 * starts with the Vault's ERR_ code when there is one, which the orchestrator
 * maps to plain language.
 *
 * Payout outcomes arrive later through the callbacks; the orchestrator polls
 * get_basket for them (pollBasket here is the same loop, for the CLI).
 */
import { Account, type KeyPairString } from 'near-api-js';
import type { VaultBasketView } from '@checkpoint/shared';
import { ChainError, type Settlement, type VaultChain } from './chain/types';

export interface SettlementConfig {
  rpcUrl: string;
  vaultId: string;
  agentAccountId: string;
  agentFcPrivateKey: string | undefined;
}

export const EXECUTE_GAS = 300_000_000_000_000n; // 300 TGas

/** First Vault error code in any error text or outcome. */
export function vaultErrorCode(x: unknown): string | undefined {
  const text = typeof x === 'string' ? x : x instanceof Error ? x.message : JSON.stringify(x);
  return /ERR_[A-Z_]+/.exec(text ?? '')?.[0];
}

interface OutcomeLike {
  transaction_outcome?: { id?: string };
  transaction?: { hash?: string };
  status?: unknown;
}

function failureOf(res: OutcomeLike): unknown {
  const s = res.status;
  return s && typeof s === 'object' && 'Failure' in s
    ? (s as { Failure: unknown }).Failure
    : undefined;
}

export function createSettlement(cfg: SettlementConfig): Settlement {
  if (!cfg.agentFcPrivateKey) {
    return {
      async execute() {
        throw new ChainError(
          'AGENT_FC_PRIVATE_KEY is not set. Add the Settlement Agent function-call key to .env (or use AGENTS_CHAIN=mock).',
        );
      },
    };
  }
  if (!cfg.agentFcPrivateKey.startsWith('ed25519:')) {
    throw new Error('AGENT_FC_PRIVATE_KEY must look like ed25519:<base58>');
  }
  const account = new Account(
    cfg.agentAccountId,
    cfg.rpcUrl,
    cfg.agentFcPrivateKey as KeyPairString,
  );

  return {
    async execute(payloadB64: string, signatureB64: string) {
      let res: OutcomeLike;
      try {
        res = (await account.callFunctionRaw({
          contractId: cfg.vaultId,
          methodName: 'execute_basket',
          args: { payload_b64: payloadB64, signature_b64: signatureB64 },
          gas: EXECUTE_GAS,
          deposit: 0n,
          waitUntil: 'EXECUTED_OPTIMISTIC',
        })) as OutcomeLike;
      } catch (e) {
        const code = vaultErrorCode(e);
        throw new ChainError(
          code
            ? `${code}: execute_basket was rejected`
            : `execute_basket failed: ${(e as Error).message}`,
        );
      }
      const failure = failureOf(res);
      if (failure !== undefined) {
        const code = vaultErrorCode(failure);
        throw new ChainError(
          code
            ? `${code}: execute_basket was rejected`
            : `execute_basket failed: ${JSON.stringify(failure)}`,
        );
      }
      const txHash = res.transaction_outcome?.id ?? res.transaction?.hash;
      if (!txHash) throw new ChainError('execute_basket: the RPC response had no transaction hash');
      return { tx_hash: txHash };
    },
  };
}

const FINAL = new Set(['Completed', 'PartiallyPaid', 'Failed']);

/** Poll get_basket every `everyMs` until the basket is final, or throw after `timeoutMs`. */
export async function pollBasket(
  chain: VaultChain,
  hashHex: string,
  { everyMs = 1_500, timeoutMs = 60_000 }: { everyMs?: number; timeoutMs?: number } = {},
): Promise<VaultBasketView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const b = await chain.getBasket(hashHex);
    if (b && FINAL.has(b.status)) return b;
    if (Date.now() > deadline)
      throw new ChainError(`basket ${hashHex} not final after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
