# Shared settings for the testnet scripts (tasks I-0.2, I-0.3, I-3.2, I-3.3).
# Keys go to the legacy keychain (~/.near-credentials/testnet/), never the repo.
# Export them to the team password manager after each run.
set -euo pipefail
ROOT="${CP_ROOT_ACCOUNT:-cpdemo.testnet}"
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
VAULT="vault.$ROOT"
TOKEN="cpusd.$ROOT"
AGENT="agent.$ROOT"
GUARDIAN="guardian.$ROOT"
OWNER="owner-demo.$ROOT"
VENDORS=(vendor-01 vendor-02 vendor-03 vendor-04 vendor-05 vendor-06)
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_JSON="$REPO/deployments/testnet.json"

command -v near >/dev/null || { echo "near-cli-rs is not installed: cargo install near-cli-rs --version 0.31.1 --locked" >&2; exit 2; }

exists() { near account view-account-summary "$1" $NET now >/dev/null 2>&1; }

say() { printf '\n== %s\n' "$*"; }
