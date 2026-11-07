import { describe, expect, it } from 'vitest';
import { createSettlement, pollBasket, vaultErrorCode } from '../src/settlement';
import { ChainError, type VaultChain } from '../src/chain/types';

describe('settlement', () => {
  it('extracts the Vault error code from any error shape', () => {
    expect(vaultErrorCode(new Error('Smart contract panicked: ERR_NO_APPROVAL'))).toBe(
      'ERR_NO_APPROVAL',
    );
    expect(
      vaultErrorCode({
        ActionError: {
          kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: ERR_GAS' } },
        },
      }),
    ).toBe('ERR_GAS');
    expect(vaultErrorCode('network down')).toBeUndefined();
  });

  it('refuses to execute without a function-call key', async () => {
    const s = createSettlement({
      rpcUrl: 'http://127.0.0.1:1',
      vaultId: 'v.testnet',
      agentAccountId: 'a.testnet',
      agentFcPrivateKey: undefined,
    });
    await expect(s.execute('AA==', 'AA==')).rejects.toThrow(ChainError);
  });

  it('rejects a key that is not ed25519:…', () => {
    expect(() =>
      createSettlement({
        rpcUrl: 'http://127.0.0.1:1',
        vaultId: 'v.testnet',
        agentAccountId: 'a.testnet',
        agentFcPrivateKey: 'secret',
      }),
    ).toThrow(/ed25519/);
  });

  it('polls until the basket is final', async () => {
    let n = 0;
    const chain: VaultChain = {
      async getApproval() {
        return null;
      },
      async getMaxVendors() {
        return 4;
      },
      async getBasket() {
        n += 1;
        return {
          hash: 'a'.repeat(64),
          basket_id: 'b',
          owner: 'o.testnet',
          agent: 'a.testnet',
          token: 't.testnet',
          total: '1',
          evidence_hash: 'c'.repeat(64),
          status: n < 3 ? 'Executing' : 'PartiallyPaid',
          created_at_ms: '1',
          payouts: [],
        };
      },
    };
    const b = await pollBasket(chain, 'a'.repeat(64), { everyMs: 1, timeoutMs: 1_000 });
    expect(b.status).toBe('PartiallyPaid');
    expect(n).toBe(3);
  });
});
