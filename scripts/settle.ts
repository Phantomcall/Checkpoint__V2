/**
 * pnpm settle -- <payload_b64> <signature_b64>   (task I-3.3)
 *
 * Manual settlement: sends execute_basket with the Settlement Agent's
 * function-call key, then polls get_basket until the payouts are final. The
 * owner must already have approved the basket hash. Needs NEAR_RPC_URL,
 * VAULT_ID, AGENT_ACCOUNT_ID and AGENT_FC_PRIVATE_KEY in .env.
 */
import { createSettlement, pollBasket, RpcVaultChain } from '@checkpoint/agents';
import { basketHashHex, decodePayload } from '@checkpoint/shared';
import { loadRootEnv } from '@checkpoint/shared/node';

loadRootEnv();

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`settle: ${name} is not set (put it in .env)`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<number> {
  const [payloadB64, signatureB64] = process.argv.slice(2).filter((a) => a !== '--');
  if (!payloadB64 || !signatureB64) {
    console.error('usage: pnpm settle -- <payload_b64> <signature_b64>');
    return 2;
  }
  const rpcUrl = need('NEAR_RPC_URL');
  const vaultId = need('VAULT_ID');
  const bytes = new Uint8Array(Buffer.from(payloadB64, 'base64'));
  const p = decodePayload(bytes);
  const hashHex = basketHashHex(bytes);
  console.log(`basket ${p.basket_id}  hash ${hashHex}`);
  for (const po of p.payouts) console.log(`  → ${po.vendor_id}  ${po.amount}`);

  const settlement = createSettlement({
    rpcUrl,
    vaultId,
    agentAccountId: need('AGENT_ACCOUNT_ID'),
    agentFcPrivateKey: need('AGENT_FC_PRIVATE_KEY'),
  });
  const { tx_hash } = await settlement.execute(payloadB64, signatureB64);
  console.log(`execute_basket tx ${tx_hash}`);
  const b = await pollBasket(new RpcVaultChain(rpcUrl, vaultId), hashHex);
  console.log(`final: ${b.status}`);
  for (const po of b.payouts) console.log(`  ${po.status.padEnd(9)} ${po.vendor}  ${po.amount}`);
  return b.status === 'Completed' ? 0 : 1;
}

main().then(
  (c) => process.exit(c),
  (e: Error) => {
    console.error(`settle: ${e.message}`);
    process.exit(1);
  },
);
