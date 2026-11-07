#!/usr/bin/env bash
# I-0.2: create the testnet account tree (PRD §6.2). Safe to re-run: existing
# accounts are skipped. Keys land in ~/.near-credentials/testnet/.
#   bash scripts/testnet/accounts.sh            # root (faucet) + sub-accounts
source "$(dirname "$0")/lib.sh"

if exists "$ROOT"; then
  say "$ROOT exists"
else
  say "Creating $ROOT via the faucet sponsor"
  near account create-account sponsor-by-faucet-service "$ROOT" autogenerate-new-keypair save-to-legacy-keychain $NET create
fi

# name → NEAR. Lean enough (~8.4 NEAR) to fit one faucet grant: the Vault and
# cpUSD wasm need ~3 and ~1.6 NEAR of storage; vendors only need an account.
# Top the Vault up to ≥ 3 NEAR free balance before go-live (FR-V09).
declare -A FUND=([vault]=4 [cpusd]=2 [agent]=0.5 [guardian]=0.3 [owner-demo]=1)
for v in "${VENDORS[@]}"; do FUND[$v]="${VENDOR_NEAR:-0.1}"; done

for name in vault cpusd agent guardian owner-demo "${VENDORS[@]}"; do
  id="$name.$ROOT"
  if exists "$id"; then say "$id exists"; continue; fi
  say "Creating $id with ${FUND[$name]} NEAR"
  near account create-account fund-myself "$id" "${FUND[$name]} NEAR" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$ROOT" $NET $SIGN
done

say "Balances"
for name in "" vault cpusd agent guardian owner-demo "${VENDORS[@]}"; do
  id="${name:+$name.}$ROOT"
  printf '%-34s ' "$id"; near account view-account-summary "$id" $NET now 2>/dev/null | grep -m1 -i "native account balance" || echo "?"
done
