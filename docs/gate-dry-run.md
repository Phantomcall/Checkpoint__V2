# Gate dry run (CLI, 7 Nov 2026)

This is a rehearsal of the Monday gate (D-4.1 / I-4.1) through the command line, with no web UI. Guard and the agents read the live testnet Vault: in `.env`, `GUARD_VAULT=rpc`, `AGENTS_CHAIN=rpc`, `GUARD_DEV=0` and `EVIDENCE_DIR=./data/snapshot`. These rows are rehearsal evidence. The gate rows in [evidence.md](evidence.md) still need a second person to check them.

| Step | Result | Proof |
|---|---|---|
| Guard startup check against the live Vault (D-5.3) | `rules_hash_match: true`, policy v1, 25 offers loaded, no `GUARD_DEV` override | `GET /v1/health` |
| `POST /v1/requests`: the demo list | Parsed by the LLM: 2× VPS, 1× .com, 1× 1 TB storage | request `state: awaiting_approval` |
| Guard `/sign-basket` (re-checks R-20 to R-24 against live views) | 66.66 cpUSD, 2 vendors: vendor-02 59.71, vendor-06 6.95 | hash `2c6d4cff…ed5e` |
| Owner approves (`approve_basket`, 1 yocto, full-access key) | Approval seen by the agents | [4UT9…NdWc](https://testnet.nearblocks.io/txns/4UT9cKAeRHxFFR8x1vUeojiaskDvhVMXiUPSUhL5NdWc) |
| Settlement Agent `execute_basket` (function-call key) | vendor-02 **Completed**, vendor-06 **Failed** (not registered on cpUSD), basket **PartiallyPaid** (AT-10) | [6Nx1…j6Nj](https://testnet.nearblocks.io/txns/6Nx1dJFXnf5XpdKpV6D4avB3Ur67XHqBW4EHnt3Pj6Nj) |
| Owner balance | 199.00 → 139.29 cpUSD available: only vendor-02's 59.71 left; vendor-06's 6.95 was restored once | `pnpm vault:check` |
| `pnpm verify:audit -- 4cfe2544-9463-430c-8cd7-19736abaff89` (D-4.2) | **PASS** on all 10 checks, including the Guard signature and the on-chain status | |
| AT-05: one byte of the signed payload changed | `ERR_BAD_SIGNATURE` | `pnpm settle` |
| AT-06: the same basket sent again | `ERR_ALREADY_USED` | `pnpm settle` |

Earlier, on 6 Nov, a 1 cpUSD payout to vendor-01 went through `pnpm settle` and finished Completed ([2ptp…F2p4](https://testnet.nearblocks.io/txns/2ptpZr2o4WnfkTmuXfxfunoDDePV9KsB5F8KS3iaF2p4)).

## Notes for Monday

- **AT-01 needs a different request.** Vendor-06 wins storage in the demo list, so that list always ends PartiallyPaid (decisions-pending #6). For AT-01, use a list where vendor-06 has no cheapest offer, e.g. VPS and domain only.
- **The public RPC is slow and once dropped a request.** Guard's health check takes about 3.2 s, and one call failed on 6 Nov. Pick the RPC provider (D-04) before the gate.
- **owner-demo has 139.29 cpUSD left in the Vault.** That's enough for the gate. Mint more with `cpusd.mint` (signed by cpusd.cpdemo.testnet) if needed.
