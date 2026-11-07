# Gas (task I-3.1, FR-A09)

`execute_basket` refuses a call whose prepaid gas is below
`BASE_GAS + n × (FT_TRANSFER_GAS + CALLBACK_GAS)` with `ERR_GAS`, before it changes any state.

| Constant | Value | Measured (sandbox, 6 Nov) | Headroom |
|---|---|---|---|
| `BASE_GAS` (execute_basket itself) | 20 TGas | ≤ 7.0 TGas | ~2.9× |
| `FT_TRANSFER_GAS` (one cpUSD `ft_transfer`) | 10 TGas | 1.73 TGas | ~5.8× |
| `CALLBACK_GAS` (one `on_payout` / `on_withdraw`) | 15 TGas | ≤ 7.0 TGas | ~2.1× |

The sandbox does not report `execute_basket` and `on_payout` separately, so 7.0 TGas is the largest Vault receipt from either.

- A 4-vendor basket burns **25 TGas in total** and needs 120 TGas prepaid. The Settlement Agent attaches 300 TGas.
- `withdraw` needs 30 TGas prepaid (5 + 10 + 15).

The headroom is well above the 30% the task asks for, so the PRD defaults (20 / 10 / 15) stay. To re-measure, run the test below. It prints a `GAS 4-vendor basket:` line.

```bash
pnpm contracts:build
cargo test -p checkpoint-sandbox-tests gas_for_a_four_vendor_basket -- --nocapture
```
