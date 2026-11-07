#!/usr/bin/env bash
# I-0.3: deploy cpUSD (no fault switches), register storage and mint.
# vendor-06 is deliberately NOT registered (AT-10).
source "$(dirname "$0")/lib.sh"
WASM="$REPO/target/near/cpusd/checkpoint_cpusd.wasm"
[ -f "$WASM" ] || { echo "Run pnpm contracts:build first" >&2; exit 2; }

say "Deploying cpUSD to $TOKEN"
near contract deploy "$TOKEN" use-file "$WASM" with-init-call new json-args "{\"owner_id\":\"$TOKEN\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' $NET $SIGN

for id in "$VAULT" "$OWNER" "$ROOT" vendor-01."$ROOT" vendor-02."$ROOT" vendor-03."$ROOT" vendor-04."$ROOT" vendor-05."$ROOT" ${EXTRA_OWNERS:-}; do
  say "storage_deposit $id"
  near contract call-function as-transaction "$TOKEN" storage_deposit json-args "{\"account_id\":\"$id\",\"registration_only\":true}" \
    prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as "$ROOT" $NET $SIGN
done

for id in "$OWNER" ${EXTRA_OWNERS:-}; do
  say "Minting 1,000 cpUSD to $id"
  near contract call-function as-transaction "$TOKEN" mint json-args "{\"account_id\":\"$id\",\"amount\":\"1000000000\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$TOKEN" $NET $SIGN
done

say "Checks"
near contract call-function as-read-only "$TOKEN" ft_balance_of json-args "{\"account_id\":\"$OWNER\"}" $NET now
near contract call-function as-read-only "$TOKEN" storage_balance_of json-args "{\"account_id\":\"vendor-06.$ROOT\"}" $NET now
