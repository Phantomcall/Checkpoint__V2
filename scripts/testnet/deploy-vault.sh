#!/usr/bin/env bash
# I-3.2: deploy and initialise the Vault (PRD §7.1). Needs the rules hash (H3)
# and the Guard public key (H8):
#   RULES_HASH=<hex> GUARD_PUBKEY=<base58> bash scripts/testnet/deploy-vault.sh
source "$(dirname "$0")/lib.sh"
WASM="$REPO/target/near/vault/checkpoint_vault.wasm"
[ -f "$WASM" ] || { echo "Run pnpm contracts:build first" >&2; exit 2; }
: "${RULES_HASH:?set RULES_HASH (pnpm rules:hash)}"
: "${GUARD_PUBKEY:?set GUARD_PUBKEY (pnpm guard keygen prints it)}"

CONFIG=$(cat <<JSON
{"config":{
  "network_id":"testnet",
  "tokens":["$TOKEN"],
  "vendors":["vendor-01.$ROOT","vendor-02.$ROOT","vendor-03.$ROOT","vendor-04.$ROOT","vendor-06.$ROOT"],
  "max_basket_total":"500000000","daily_cap":"1000000000","max_vendors":4,"max_ttl_ms":"1800000",
  "rules_hash":"$RULES_HASH","guard_pubkey":"$GUARD_PUBKEY","guard_key_version":1,
  "guardian":"$GUARDIAN","dao_id":"$ROOT"}}
JSON
)
say "Deploying the Vault to $VAULT"
near contract deploy "$VAULT" use-file "$WASM" with-init-call new json-args "$CONFIG" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET $SIGN

say "get_policy"
near contract call-function as-read-only "$VAULT" get_policy json-args '{}' $NET now
