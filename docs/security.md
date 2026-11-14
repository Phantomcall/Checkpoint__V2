# Security checklist and permission inventory (I-6.2, FR-G06)

As of 9 Nov 2026, testnet, Vault policy v4. Re-check against `near account list-keys` and `get_policy` before the freeze (I-7.1).

## Who can call what on the Vault

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `new(config)` | deployer, once | 0 | `#[init]` refuses a second call |
| `ft_on_transfer` | an allowlisted token | 0 | Credits `sender_id` only. Unknown tokens, a zero amount or a flagged deficit are refunded in full. |
| `withdraw(token_id, amount)` | the owner | exactly 1 yocto | Allowed while paused, refused during a deficit. Funds move to `withdrawing`, then the callback settles or restores them. |
| `set_agent`, `set_owner_limits` | the owner (must have deposited) | exactly 1 yocto | ≤ 3 agents. Owner limits are ≤ the global ones. |
| `approve_basket`, `revoke_approval` | the owner (must have deposited) | exactly 1 yocto | 1 yocto means a dapp's function-call key can't approve. Expiry must be ≤ now + max TTL. |
| `execute_basket(payload_b64, signature_b64)` | the owner's authorised agent | 0 | The function-call key path. Every check (FR-A04–A09) runs before any state change. |
| `on_payout`, `on_withdraw`, `on_solvency` | the Vault itself | 0 | `#[private]`. Only `Executing → final` is allowed (`ERR_BAD_STATE`). |
| `check_solvency(token_id)` | anyone | 0 | Can only set `deficit` + `paused`. Skips if balances moved during the check. |
| `set_vendor`, `set_token`, `set_limits`, `set_rules_hash`, `set_guard_key`, `set_guardian`, `transfer_admin` | `dao_id` | exactly 1 yocto | Each bumps `policy_version` and emits `policy_updated`. FR-G03 bounds are hard-coded. |
| `unpause`, `clear_deficit`, `resolve_stuck_payout` | `dao_id` | exactly 1 yocto | `unpause` is refused while a deficit is flagged. `resolve_stuck_payout` only works on payouts still Executing after 10 min or more. |
| `emergency_pause(reason)`, `disable_guard_key()` | guardian or `dao_id` | exactly 1 yocto | The guardian has no other power: unpause and setters fail `ERR_NOT_DAO`. |
| views | anyone | – | `get_policy`, `get_status`, `get_balance`, `get_owner_state`, `get_liabilities`, `get_approval`, `get_basket`, `get_baskets` |

`dao_id` is **`checkpoint-council.sputnik-v2.testnet`** since 9 Nov (I-5.1). Since 10 Nov the council is `david-checkpoint.testnet` and `patrick-checkpoint.testnet`, and **both** must approve (Sputnik ratio 1/2 of 2 members needs 2 votes). `isaac-cp.testnet` was removed by proposal 2 when the team became two people. `cpdemo.testnet` lost admin rights at the hand-over: its `set_vendor` now fails `ERR_NOT_DAO`.

## Access keys (testnet, rechecked 13 Nov)

| Account | Keys | Plan |
|---|---|---|
| `vault.cpdemo.testnet` | None. Full access `ed25519:2omt…VT9b` deleted 13 Nov in [`6gwftqLp3kdYj4z4nFQEU6Tc79E4CefMj5eT7TQAv9CS`](https://testnet.nearblocks.io/txns/6gwftqLp3kdYj4z4nFQEU6Tc79E4CefMj5eT7TQAv9CS), after the code hash still matched the repo. | The code cannot be replaced from this keychain. A fix needs a new account or a DAO path that does not exist on this contract. |
| `cpusd.cpdemo.testnet` | 1 full access | Token owner (mint). Test token, no value. |
| `agent.cpdemo.testnet` | Function-call key `ed25519:719F…FREG` only: receiver `vault.cpdemo.testnet`, method `execute_basket`, allowance about 0.988 NEAR. Full access `ed25519:7MN9…A3dJ` deleted 13 Nov in [`388ecPLjJBb2c5bEzqenprHp4j5oDNw7P3ghTxTAiho4`](https://testnet.nearblocks.io/txns/388ecPLjJBb2c5bEzqenprHp4j5oDNw7P3ghTxTAiho4). | The function-call key lives in the agents' `.env`. AT-08 shows it can't call anything else or attach deposits. |
| `guardian.cpdemo.testnet` | 1 full access | Pause and disable-key only |
| `owner-demo.cpdemo.testnet` | 1 full access | Demo owner. Approvals need this key, not a function-call key. |
| `cpdemo.testnet` | 1 full access | Root of the account tree. No Vault powers since the hand-over. |
| `david-checkpoint.testnet` | 1 full access (David) | Council member |
| `patrick-checkpoint.testnet` | 1 full access (**Patrick's own key**, since 10 Nov) | Council member. The key created on David's machine was deleted. |
| `isaac-cp.testnet` | 1 full access (on David's machine) | No longer on the council (proposal 2). No powers. |

All the full-access keys are currently in one person's `~/.near-credentials/testnet/`. **Copy them to the team password manager.**

DAO: created from the `sputnik-v2.testnet` factory with the default policy (council threshold 1/2, proposal bond 1 NEAR, proposal period 7 days). Upgrades are meant to go through council-voted `UpgradeSelf` proposals. Check what powers the factory itself keeps over its DAOs before the README claims this.

## Checklist

| Item | Status | Where |
|---|---|---|
| Checks, then effects, then interactions in `execute_basket` (INV-5) | ✅ | `execute.rs`. Table-driven test shows every ERR_ path leaves state unchanged. |
| Balances only move through the `bal_*` helpers, which keep liabilities and in-flight in step (INV-1) | ✅ | `state.rs`. INV-1 is asserted in unit tests, sandbox tests and `pnpm demo:sandbox`. |
| Callbacks are `#[private]`, read promise results bounded (16 bytes), and don't unwrap external data | ✅ | `deposits.rs` `transfer_succeeded` |
| Payouts are independent promise chains; one bad vendor doesn't block the others | ✅ | AT-10 in the sandbox, `demo:sandbox` and on testnet |
| Replay protection: hash used once, approval consumed (INV-3) | ✅ | AT-06 |
| A replay is checked before the approval, so it is reported correctly | ✅ | decisions-pending #18 |
| Exact 1 yocto on every owner/admin action (no function-call-key approvals) | ✅ | `assert_one_yocto` |
| Overflow: release builds keep `overflow-checks = true`; sums are checked | ✅ | root `Cargo.toml`, `ERR_TOTAL_MISMATCH` |
| Storage griefing: owner actions need a prior deposit | ✅ | `ERR_UNKNOWN_OWNER` (decisions-pending #17) |
| The Vault re-checks caps, vendors and token, even if Guard is wrong | ✅ | AT-04 and AT-09 on testnet |
| Guard fails closed: RPC down or a policy/rules mismatch → 503, no signature | ✅ | AT-14 in tests, the sandbox and the 9 Nov gate (live RPC drop) |
| Guard: rate limit 30/min/IP, request IDs, secret redaction in logs | ✅ | `packages/guard` (D-5.3) |
| LLM can't choose offers, vendors or amounts; output is schema-validated and number-checked | ✅ | AT-13 |
| No secrets in git (gitleaks in pre-commit and CI over full history) | ✅ | CI `secrets` job |
| Agents API has no auth (anyone can open a request for any owner) | ⚠️ accepted | Nothing moves without the owner's on-chain approval. Listed as a limitation. |
| Vault full-access key | ✅ removed 13 Nov | `6gwftq…v9CS`. The agent full-access key went in the same pass (`388ecP…iho4`). |
| Reconciliation can't tell a deficit from in-flight transfers; it is conservative | ⚠️ documented | decisions-pending #23 |
| Callback out-of-gas path tested only in unit tests | ⚠️ open | AT-19. A sandbox test is still to write. |

## Contract limitations (for the README, I-8.2)

- **One token in practice.** The allowlist holds any NEP-141, but amounts and caps are in that token's base units, with no price conversion. The demo uses cpUSD (6 decimals).
- **`ft_transfer` must be atomic in the token** (a panic moves nothing). That holds for cpUSD and for tokens we review. A token that takes funds and then fails would break FR-S05's restore.
- **Deposits only credit the sender.** `msg` is ignored in v1.
- **An expired approval reports `ERR_EXPIRED`**, not `ERR_NO_APPROVAL`.
- **Reconciliation** skips when balances move during the check, and treats in-flight funds conservatively.
- **A stuck payout** (callback out of gas) needs a DAO vote, `resolve_stuck_payout`, at least 10 minutes later.
- **Testnet only.** Mainnet is refused by Guard and the agents (NFR-02).

## Handing over a council account

A new member sends **only their public key** (`ed25519:…`), never a private key; for example from `near account create-account fund-later use-auto-generation save-to-folder ~/.near-credentials/implicit`. Then:

```bash
bash scripts/testnet/handover-key.sh <account>.testnet ed25519:<their public key>
```

The script adds their key, checks it is on chain, and only then deletes the key created on this machine. Patrick's seat was handed over this way on 10 Nov.
