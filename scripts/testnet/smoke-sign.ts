/**
 * Testnet smoke test helper (I-3.3 done-when). Builds a 1-vendor basket for
 * owner-demo, signs it with GUARD_SECRET_KEY from .env and prints JSON:
 * {payload_b64, signature_b64, hash_hex, expires_at_ms}. It deliberately skips
 * Guard's offer rules (the gate run covers those); the Vault still re-checks
 * every money rule. The secret is never printed.
 *
 *   pnpm exec tsx scripts/testnet/smoke-sign.ts [vendor] [amount_base_units]
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { GuardSigner } from '@checkpoint/guard';
import {
  basketHash,
  encodePayload,
  fromHex,
  toHex,
  VaultPolicyViewSchema,
  viewFunction,
} from '@checkpoint/shared';
import { loadRootEnv } from '@checkpoint/shared/node';

loadRootEnv();

async function main(): Promise<void> {
  const rpc = process.env.NEAR_RPC_URL!;
  const vault = process.env.VAULT_ID!;
  const root = vault.split('.').slice(1).join('.');
  const vendor = process.argv[2] ?? `vendor-01.${root}`;
  const amount = BigInt(process.argv[3] ?? '1000000');
  const policy = VaultPolicyViewSchema.parse(await viewFunction(rpc, vault, 'get_policy', {}));
  const signer = GuardSigner.fromEnv(process.env.GUARD_SECRET_KEY);
  if (signer.publicKeyB58 !== policy.guard_pubkey)
    throw new Error('GUARD_SECRET_KEY does not match the Vault Guard key');
  const now = BigInt(Date.now());
  const bytes = encodePayload({
    schema_version: 1,
    network_id: policy.network_id,
    vault_id: vault,
    policy_version: policy.policy_version,
    rules_hash: fromHex(policy.rules_hash),
    guard_key_version: policy.guard_key_version,
    basket_id: randomUUID(),
    owner_id: `owner-demo.${root}`,
    agent_id: process.env.AGENT_ACCOUNT_ID ?? `agent.${root}`,
    token_id: process.env.TOKEN_ID!,
    payouts: [{ vendor_id: vendor, amount, line_count: 1 }],
    total: amount,
    evidence_hash: new Uint8Array(32),
    nonce: BigInt('0x' + randomBytes(8).toString('hex')),
    created_at_ms: now,
    expires_at_ms: now + 15n * 60_000n,
  });
  const hash = basketHash(bytes);
  console.log(
    JSON.stringify({
      payload_b64: Buffer.from(bytes).toString('base64'),
      signature_b64: Buffer.from(signer.sign(hash)).toString('base64'),
      hash_hex: toHex(hash),
      expires_at_ms: String(now + 15n * 60_000n),
    }),
  );
}

main().catch((e: Error) => {
  console.error(`smoke-sign: ${e.message}`);
  process.exit(1);
});
