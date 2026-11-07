/**
 * pnpm vault:check   (handoff H5 smoke test)
 *
 * Reads the live Vault views over NEAR_RPC_URL and parses each one with the
 * same Zod schemas Guard, the agents and the web app use, so a shape mismatch
 * shows up here instead of as a Guard 503.
 */
import {
  VaultBalanceViewSchema,
  VaultOwnerStateViewSchema,
  VaultPolicyViewSchema,
  viewFunction,
} from '@checkpoint/shared';
import { loadRootEnv } from '@checkpoint/shared/node';

loadRootEnv();

async function main(): Promise<number> {
  const rpc = process.env.NEAR_RPC_URL;
  const vault = process.env.VAULT_ID;
  const token = process.env.TOKEN_ID;
  const owner =
    process.argv[2] ?? process.env.OWNER_ID ?? `owner-demo.${vault?.split('.').slice(1).join('.')}`;
  if (!rpc || !vault || !token) {
    console.error('vault:check: set NEAR_RPC_URL, VAULT_ID and TOKEN_ID in .env');
    return 2;
  }
  const policy = VaultPolicyViewSchema.parse(await viewFunction(rpc, vault, 'get_policy', {}));
  console.log(
    `get_policy        ok  v${policy.policy_version}  rules ${policy.rules_hash.slice(0, 12)}…  guard ${policy.guard_pubkey}`,
  );
  const os = VaultOwnerStateViewSchema.parse(
    await viewFunction(rpc, vault, 'get_owner_state', { owner_id: owner }),
  );
  console.log(
    `get_owner_state   ok  ${owner}  agents [${os.agents.join(', ')}]  spent ${os.spent_today}`,
  );
  const bal = VaultBalanceViewSchema.parse(
    await viewFunction(rpc, vault, 'get_balance', { owner_id: owner, token_id: token }),
  );
  console.log(`get_balance       ok  available ${bal.available}  reserved ${bal.reserved}`);
  const approval = await viewFunction(rpc, vault, 'get_approval', { hash_hex: '0'.repeat(64) });
  console.log(`get_approval      ok  ${JSON.stringify(approval)}`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e: Error) => {
    console.error(`vault:check: ${e.message}`);
    process.exit(1);
  },
);
