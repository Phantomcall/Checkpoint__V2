#!/usr/bin/env bash
# I-3.3: add the Settlement Agent's function-call key: receiver = Vault,
# method = execute_basket only, 1 NEAR allowance. The key pair is saved to the
# legacy keychain and written into .env as AGENT_FC_PRIVATE_KEY without being
# printed. Copy it to the team password manager afterwards.
source "$(dirname "$0")/lib.sh"
DIR="$HOME/.near-credentials/testnet/$AGENT"
before=$(ls "$DIR" 2>/dev/null || true)
near account add-key "$AGENT" grant-function-call-access --allowance '1 NEAR' \
  --contract-account-id "$VAULT" --function-names execute_basket \
  autogenerate-new-keypair save-to-legacy-keychain $NET sign-with-legacy-keychain send >/dev/null
new=$(comm -13 <(echo "$before" | sort) <(ls "$DIR" | sort) | head -1)
[ -n "$new" ] || { echo "could not find the new key file in $DIR" >&2; exit 1; }
python3 - "$DIR/$new" "$REPO/.env" "$AGENT" <<'PY'
import json, re, sys, os
key_file, env_file, agent = sys.argv[1:]
sk = json.load(open(key_file))["private_key"]
s = open(env_file).read() if os.path.exists(env_file) else ""
for k, v in (("AGENT_FC_PRIVATE_KEY", sk), ("AGENT_ACCOUNT_ID", agent)):
    line = f"{k}={v}"
    s = re.sub(rf"^{k}=.*$", line, s, flags=re.M) if re.search(rf"^{k}=", s, flags=re.M) else s.rstrip("\n") + "\n" + line + "\n"
open(env_file, "w").write(s)
os.chmod(env_file, 0o600)
print("public key:", json.load(open(key_file))["public_key"])
PY
say "Access keys on $AGENT"
near account list-keys "$AGENT" $NET now | grep -E "ed25519|FunctionCall|FullAccess|execute_basket" || true
