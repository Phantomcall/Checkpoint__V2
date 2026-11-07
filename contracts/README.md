# Contracts

| Crate | What it is |
|---|---|
| [`vault/`](vault/) | **Checkpoint Vault** (PRD §8.1–8.4). It holds owners' NEP-141 tokens and pays vendors only for baskets that Guard signed and the owner approved. |
| [`cpusd/`](cpusd/) | **cpUSD**, the NEP-141 test token (6 decimals, no value). The owner can mint. The `sandbox` feature adds the test-only `set_fail_transfers` and `burn_from`. |
| [`sandbox-tests/`](sandbox-tests/) | near-workspaces tests that run the real wasm against a real cpUSD in a local sandbox. |

```bash
pnpm contracts:build        # cargo-near 0.23 → target/near/{vault,cpusd,cpusd-sandbox}/*.wasm
cargo test --workspace      # unit tests (incl. the shared vector) + sandbox tests
```

You need Rust (pinned by `rust-toolchain.toml`) and `cargo install cargo-near --version 0.23.0 --locked`. The first sandbox run downloads the `near-sandbox` binary.

## Vault layout

| File | Contents |
|---|---|
| `lib.rs` | State, `new(config)`, and the FR-G03 bounds |
| `state.rs` | Stored types. Balances only move through the `bal_*` helpers, which keep `liabilities` and `in_flight` in step (INV-1). |
| `payload.rs` | `BasketPayloadV1` (Borsh, field order is binding) and `basket_hash` |
| `deposits.rs` | `ft_on_transfer`, `withdraw`, `on_withdraw` |
| `approvals.rs` | `set_agent`, `set_owner_limits`, `approve_basket`, `revoke_approval` |
| `execute.rs` | `execute_basket` (checks, then effects, then interactions), `on_payout`, `resolve_stuck_payout` |
| `admin.rs` | DAO setters, `transfer_admin`, `unpause`, `clear_deficit`, and the guardian's `emergency_pause` and `disable_guard_key` |
| `solvency.rs` | `check_solvency` / `on_solvency` |
| `views.rs` | `get_policy`, `get_status`, `get_balance`, `get_owner_state`, `get_liabilities`, `get_approval`, `get_basket`, `get_baskets` |
| `errors.rs`, `events.rs` | Stable `ERR_` strings and NEP-297 events |

### Check order in `execute_basket`

1. Pause and deficit.
2. Decode the payload and hash it.
3. Gas.
4. Guard signature, then key version or disabled key.
5. Domain fields.
6. **Replay.**
7. Agent and approval.
8. Expiry and TTL.
9. Token, payout count, vendors, amounts, total, caps and available balance.

Replay is checked before the approval because execution consumes the approval. A replay therefore fails with `ERR_ALREADY_USED` (AT-06), not `ERR_NO_APPROVAL`.

## Test coverage

| Acceptance test | Where |
|---|---|
| Shared vector (H1): bytes, hash, signature, trailing bytes rejected | `vault/src/tests.rs` `shared_vector_…` |
| Every `execute_basket` ERR_ path, with no state change | `vault/src/tests.rs` `every_execute_error_code_…` (table-driven) |
| AT-01: two vendors paid, INV-1 holds | `sandbox-tests` `at01_…` |
| AT-05: edit after approval / AT-11: racing baskets | `sandbox-tests` `at05_…` |
| AT-06: replay | `at01_…` (sandbox) and the unit tests |
| AT-07: approval made under an old policy fails | `vault/src/tests.rs` `dao_changes_…` |
| AT-08: a stolen function-call key | `sandbox-tests` `at08_…` |
| AT-09: Vault re-checks the caps | the `ERR_OVER_BASKET_CAP` / `ERR_OVER_DAILY_CAP` rows in the unit tests |
| AT-10: an unregistered vendor gives PartiallyPaid, and funds are restored once | `sandbox-tests` `at10_…` |
| AT-12: callbacks are private, and a second settle is rejected | `sandbox-tests` `at12_…`, unit tests |
| AT-15: admin methods are DAO-only | `vault/src/tests.rs` `admin_methods_reject_non_dao_callers` |
| AT-16: guardian pause; withdrawals continue | `sandbox-tests` `withdraw_failure_…`, unit tests |
| AT-17: deficit / AT-18: donation surplus | `sandbox-tests` `at17_…` |
| Withdraw failure restores `available` | `sandbox-tests` `withdraw_failure_…` |
| Gas (docs/gas.md) | `sandbox-tests` `gas_for_a_four_vendor_basket` |
