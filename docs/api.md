# Guard and agents API

The HTTP contracts from PRD §11.4–11.5. The Zod schemas in [`packages/shared/src/api.ts`](../packages/shared/src/api.ts) are the source of truth: the services validate against them, and the web app should import the same types (`@checkpoint/shared`), so a contract change breaks the build instead of the demo.

All amounts are **decimal strings of integers** (micro-USD for prices, token base units for cpUSD). All hashes are lowercase hex. Additions to the frozen PRD interfaces are marked **(added)** and listed in [decisions-pending.md](decisions-pending.md).

## Run it

| Command | What runs | Needs |
|---|---|---|
| `pnpm mock` | Agents API on `:8788` with Guard in-process, a fake Vault, wallet and settlement, and the synthetic dev snapshot | Nothing |
| `pnpm guard:dev` / `pnpm agents:dev` | Real services (`.env` decides testnet or mock Vault/chain) | `.env` |
| `pnpm dev:services` | Both, in watch mode | `.env` |

Local Guard + agents with no chain: `GUARD_DEV=1 GUARD_VAULT=mock AGENTS_CHAIN=mock EVIDENCE_DIR=./data/fixtures/dev-snapshot pnpm dev:services`.

---

## Guard (port 8787)

### `GET /v1/health`
`200` when Guard can read the Vault and agrees with it (network, rules hash, Guard key), else `503`.
```json
{ "ok": true, "rpc_ok": true, "vault_policy_version": 1, "rules_hash_match": true }
```

### `GET /v1/policy`
```json
{
  "rules": { "version": 1, "min_offers": 3, "max_age_hours": 720, "bps": { "good_max": 10500, "fair_max": 12000, "low_min": 5000 }, "currency": "USD", "usd_to_token": { "decimals": 6, "rate_micro": 1000000 } },
  "rules_hash": "89e1b151b955375cf1ae7b5af890d0212ad6284e21dc280bc504090d63f9c23d",
  "guard_pubkey_b58": "52cQ8Ysgi…",
  "guard_key_version": 1,
  "vault_id": "vault.cpdemo.testnet",
  "network_id": "testnet"
}
```

### `POST /v1/assess`
Request: offer IDs only. **Any key that looks like a price** (`price`, `amount`, `total`, `fee`, `cost`, `usd`) anywhere in the body → `400 PRICE_FIELD_REJECTED` (FR-R02).
```json
{ "offer_ids": ["vps-a", "vps-d"], "owner_id": "owner-demo.cpdemo.testnet" }
```
Response: one verdict per requested offer, in request order. Medians are over **all** offers of each item in the snapshot, not just the ones requested.
```json
{
  "verdicts": [{
    "offer_id": "vps-a", "item_key": "vps-2c4g-month", "vendor_id": "vendor-01.cpdemo.testnet",
    "level": "ALLOW",
    "findings": [{ "rule_id": "R-08", "name": "PRICE_GOOD", "level": "ALLOW",
                   "message": "Price is 100.00% of the median ($12.00 vs median $12.00).",
                   "inputs": { "unit_price_micro": "12000000", "median_micro": "12000000", "ratio_bps": 10000, "count": 5 } }],
    "unit_price_micro": "12000000", "ratio_bps": 10000,
    "assessed_at": "2026-11-06T00:00:00.000Z",
    "rules_hash": "89e1b151…"
  }],
  "medians": { "vps-2c4g-month": "12000000" },
  "assessed_at": "2026-11-06T00:00:00.000Z"
}
```
`unit_price_micro` and `ratio_bps` on the verdict are **(added)** so the offers table can show "ratio to median" without digging into findings. Both are `null` when the price is unusable.

### `POST /v1/sign-basket`
Guard rebuilds every amount from the offer IDs, re-runs every offer rule and the basket rules R-20–R-24 against live Vault views, then builds the Borsh payload, hashes it and signs the hash.
```json
{
  "request_id": "7c491ddd-0740-4704-8fa4-325888305765",
  "basket_id": "304b64d4-2de2-4610-a0f9-661ca43bdb56",
  "owner_id": "owner-demo.cpdemo.testnet",
  "agent_id": "agent.cpdemo.testnet",
  "token_id": "cpusd.cpdemo.testnet",
  "lines": [{ "item_key": "vps-2c4g-month", "offer_id": "vps-b", "qty": 2 }],
  "acknowledged_offer_ids": [],
  "evidence_hash": "606b435f…(64 hex)"
}
```
`basket_id` is **(added, optional)**: the agents pass the ID that is already inside the hashed evidence bundle, so the payload and the bundle name the same basket.

| Status | Body | When |
|---|---|---|
| `200` | `{ payload_b64, hash_hex, signature_b64, guard_key_version, expires_at_ms, basket_id, payouts[], total, findings[] }` | Every rule passed. `findings` lists the REVIEW findings the owner acknowledged. |
| `400` | `{ code: BAD_REQUEST \| PRICE_FIELD_REJECTED \| UNKNOWN_OFFER, message }` | Bad input |
| `422` | `{ code: GUARD_REFUSED, message, findings[] }` | A BLOCK line, an unacknowledged REVIEW line (R-24), over a cap, low balance, agent not authorised, Vault paused |
| `503` | `{ code: GUARD_DEPENDENCY_DOWN \| RULES_HASH_MISMATCH \| GUARD_KEY_MISMATCH, message }` | Cannot read the Vault, or Guard and Vault disagree. **Fail closed: never a signature.** |
| `429` | `{ code: RATE_LIMITED }` | More than 30 requests/minute from one client |

Signatures are valid for 15 minutes, capped by the Vault's `max_ttl_ms`.

---

## Agents (port 8788)

| Endpoint | Body → response |
|---|---|
| `POST /v1/requests` | `{ owner_id, text, constraints?: { max_total?, preferred_vendors? } }` → `201 { request_id }` |
| `GET /v1/requests?owner_id=…` **(added)** | `{ requests: [{ request_id, created_at, text, state, total }] }`, newest first (Desk history, P-2.1) |
| `GET /v1/requests/:id` | The full request view (below) |
| `GET /v1/requests/:id/events` | SSE stream (below) |
| `POST /v1/requests/:id/acknowledge` | `{ offer_ids }` → `202`. Only REVIEW offers; triggers re-plan and re-sign. `409` in a state where acknowledging makes no sense. |
| `POST /v1/requests/:id/cancel` | Stops the approval watcher. `409` once executing or finished. |
| `GET /v1/audit/:basket_id` | The evidence bundle |
| `GET /v1/catalog` | `{ items: CatalogItem[] }` (each with `aliases` for list hints) |
| `GET /v1/health` | `{ ok: true }` |

`constraints.max_total` is in cpUSD base units.

### Request view
`GET /v1/requests/:id` returns the state derived from the event log with the **same reducer the web app should use**: `replayRequest(events)` / `reduceRequest(view, event)` from `@checkpoint/shared`. Fields: `request_id, owner_id, text, constraints, state, parser, items, unmatched, offers, verdicts (by offer_id), medians (by item_key), basket, acknowledged_offer_ids, needs_ack, signed, refusal, approval, settlement { tx_hash, payouts, final_status }, explanations { verdicts, basket }, errors, last_seq`.

States: `created → parsed → researched → assessed → (needs_ack) → signed → awaiting_approval → executing → final`, or `refused`, `expired`, `cancelled` **(added)**.

### SSE: `GET /v1/requests/:id/events`
- Each message has `id: <seq>`, `event: <type>` and `data: <the full JSON envelope>`.
- Reconnects resume from `Last-Event-ID` (browsers send it automatically); `?after=<seq>` does the same for clients that cannot set headers.
- A `: ping` comment every 15 s keeps proxies from closing the stream.
- Because events are **named**, `EventSource.onmessage` will not see them. Add one listener per type:

```ts
import { AGENT_EVENT_TYPES, AgentEventSchema, reduceRequest, initialRequestView } from '@checkpoint/shared';
const es = new EventSource(`${AGENTS_URL}/v1/requests/${id}/events`);
let view = initialRequestView();
for (const t of AGENT_EVENT_TYPES) {
  es.addEventListener(t, (m) => { view = reduceRequest(view, AgentEventSchema.parse(JSON.parse(m.data))); render(view); });
}
```

Envelope: `{ seq, ts, type, data }`. Examples from the mock (trimmed):

| type | data |
|---|---|
| `request.created` | `{ request_id, owner_id, text, constraints }` |
| `research.parsed` | `{ items: [{ item_key: "vps-2c4g-month", qty: 2 }, …], parser: "deterministic" }` |
| `research.unmatched` | `{ unmatched: [{ text: "unicorn", reason: "no catalogue item matches" }] }` |
| `research.offer` | `{ offer: { offer_id, item_key, vendor_id, seller_name, product_title, spec, quantity, price_total_micro_usd: 12000000, currency: "USD", source_url, captured_at, capture_method, raw_text?, … } }` |
| `policy.verdict` | `{ verdict: Verdict, median_micro: "12000000" }` |
| `explain.verdict` | `{ offer_id, text: "Allowed: Price is 100.00% of the median …", source: "template" \| "llm", advisory: true }` |
| `coordinator.basket` | `{ basket: { basket_id, request_id, owner_id, token_id, lines[{ item_key, offer_id, vendor_id, qty, unit_price_micro, amount, level, needs_ack }], payouts[{ vendor_id, amount, line_count }], total, evidence_hash }, acknowledged_offer_ids }` |
| `coordinator.needs_ack` | `{ offer_ids: ["sto-b"], reasons: [{ offer_id, findings }] }` |
| `guard.signed` | `{ signed: { payload_b64, hash_hex, signature_b64, guard_key_version, expires_at_ms }, basket_id, payouts, total, findings }` |
| `guard.refused` | `{ code: "GUARD_REFUSED" \| "GUARD_UNAVAILABLE" \| …, message, findings }` |
| `explain.basket` | `{ text: "3 line(s) from 3 vendor(s), total 38.98 cpUSD. …", source, advisory: true }` |
| `approval.waiting` | `{ hash_hex, expires_at_ms }` |
| `approval.seen` | `{ hash_hex, owner_id }` |
| `approval.expired` | `{ hash_hex }` |
| `settlement.submitted` | `{ hash_hex, tx_hash }` |
| `settlement.payout` | `{ index, vendor_id, amount, status: "Completed" \| "Failed", tx_hash }` (the execute tx; payouts run in its receipts) |
| `settlement.final` | `{ hash_hex, status: "Completed" \| "PartiallyPaid" \| "Failed" }` |
| `error` | `{ code, message, recoverable }` (see below) |

A new `coordinator.basket` (after an acknowledgement) **supersedes** any earlier signature: the UI must drop the old hash and approval button.

`error` codes: `GUARD_UNAVAILABLE`, `CHAIN_UNAVAILABLE`, `NO_ITEMS`, `NO_OFFERS`, `NO_ELIGIBLE_OFFER`, `VENDOR_CAP`, `OVER_OWNER_BUDGET`, `SIGNED_BASKET_MISMATCH`, `SETTLEMENT_FAILED` or a Vault `ERR_*` code, `SETTLEMENT_TIMEOUT`, `LLM_PARSE_FAILED`, `LLM_EXPLAIN_FAILED`, `CANCELLED`, `INTERNAL`. `recoverable: false` ends the request (`refused`, or `cancelled`).

### Mock-only switches (`pnpm mock`)
`GET /v1/dev/state` · `POST /v1/dev/approve/:hash { owner_id, expires_at_ms }` (approve from the "wallet") · `POST /v1/dev/auto-approve { ms }` (0 = never, to see `approval.expired`; pair with `MOCK_TTL_MS=20000`) · `POST /v1/dev/guard-down { down }` (AT-14) · `POST /v1/dev/chain-down { down }`. The mock auto-approves after 4 s and fails vendor-06's payout, so one run shows `PartiallyPaid`.

---

## Evidence bundle (`GET /v1/audit/:basket_id`)

```
{ core: EvidenceCore, evidence_hash, signed: SignedBasket | null,
  chain: { approve_tx, execute_tx, payouts[{ index, vendor_id, amount, status }], final_status } }
```
`evidence_hash = sha256(canonicalJson(core))`. `core` holds only what exists before signing: the request, every offer and verdict for the requested items, the rules config and hash, the acknowledgements and the basket. `signed` and `chain` are added later and are **not** hashed. `canonicalJson` is RFC 8785 (JCS) restricted to integers: sorted keys, no whitespace.

Verify anywhere with `verifyEvidenceBundle(bundle, { guardPubkeyB58, chainBasket })` from `@checkpoint/shared`, or `pnpm verify:audit <basket_id> [--rpc URL --vault ID]`.

---

## Vault views Guard and the agents read

The PRD names these views but not their JSON. `contracts/vault/src/views.rs` implements exactly these shapes (checked live with `pnpm vault:check`). The services parse them with the schemas in [`packages/shared/src/vault-views.ts`](../packages/shared/src/vault-views.ts) and fail closed on any other shape. Amounts are U128 strings.

| View | Args | Returns |
|---|---|---|
| `get_policy` | `{}` | `{ network_id, tokens[], vendors[], max_basket_total, daily_cap, max_vendors, max_ttl_ms, rules_hash (hex), guard_pubkey (base58), guard_key_version, guard_key_disabled, guardian, dao_id, policy_version, paused, deficit }` |
| `get_owner_state` | `{ owner_id }` | `{ agents[], day, spent_today, max_basket, daily_cap }` (`max_basket`/`daily_cap` effective; Guard treats `spent_today` as 0 if `day` is not today) |
| `get_balance` | `{ owner_id, token_id }` | `{ available, reserved, withdrawing }` |
| `get_approval` | `{ hash_hex }` | `null` or `{ owner, expires_at_ms, created_at_ms }` |
| `get_basket` | `{ hash_hex }` | `null` or `{ hash, basket_id, owner, agent, token, total, evidence_hash (hex), status, created_at_ms, payouts[{ vendor, amount, status }] }` |

`settlement.ts` in the agents package is the slot for Isaac's Settlement module (I-3.3, H9): `execute(payload_b64, signature_b64) → { tx_hash }`.
