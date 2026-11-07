//! execute_basket (FR-A03 to FR-A10) and the payout callbacks (FR-S01 to FR-S05, FR-S08).
//!
//! Checks first, effects next, interactions last (INV-5): every check runs
//! before any state changes, and a failing check aborts the whole call.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, AccountId, Gas, NearToken};

use crate::deposits::{ext_ft, transfer_succeeded, CALLBACK_GAS, FT_TRANSFER_GAS};
use crate::errors::*;
use crate::events::emit;
use crate::hexutil::{hash_arg, to_hex};
use crate::payload::{basket_hash, BasketPayloadV1};
use crate::state::{Basket, BasketStatus, Payout, PayoutStatus};
use crate::{today, Vault, VaultExt, STUCK_PAYOUT_MS};

/// Gas execute_basket needs for itself, before the per-payout gas (FR-A09).
pub const BASE_GAS: Gas = Gas::from_tgas(20);

/// Prepaid gas a basket with `n` payouts needs.
pub fn required_gas(n: usize) -> Gas {
    let per = FT_TRANSFER_GAS.saturating_add(CALLBACK_GAS).as_gas();
    Gas::from_gas(
        BASE_GAS
            .as_gas()
            .saturating_add(per.saturating_mul(n as u64)),
    )
}

fn account(s: &str) -> AccountId {
    s.parse().unwrap_or_else(|_| fail(ERR_DECODE))
}

#[near]
impl Vault {
    /// Pay a Guard-signed, owner-approved basket. Callable by the owner's
    /// authorised agent with a function-call key (no deposit). Returns the basket
    /// hash (hex); poll `get_basket` for the payout outcomes.
    pub fn execute_basket(
        &mut self,
        payload_b64: Base64VecU8,
        signature_b64: Base64VecU8,
    ) -> String {
        check(!self.policy.paused, ERR_PAUSED);
        check(!self.policy.deficit, ERR_DEFICIT);

        // FR-A03: decode the exact bytes and hash them.
        let bytes = payload_b64.0;
        let p = BasketPayloadV1::decode(&bytes).unwrap_or_else(|| fail(ERR_DECODE));
        let hash = basket_hash(&bytes);
        let hash_hex = to_hex(&hash);

        // FR-A09: enough gas for every payout and callback, before anything else.
        check(env::prepaid_gas() >= required_gas(p.payouts.len()), ERR_GAS);

        // FR-A04: Guard signature over the hash with the active key.
        let sig: [u8; 64] = signature_b64
            .0
            .try_into()
            .unwrap_or_else(|_| fail(ERR_BAD_SIGNATURE));
        check(
            env::ed25519_verify(&sig, hash, &self.policy.guard_pubkey),
            ERR_BAD_SIGNATURE,
        );
        check(
            !self.policy.guard_key_disabled && p.guard_key_version == self.policy.guard_key_version,
            ERR_KEY_VERSION,
        );

        // FR-A05: domain.
        check(p.schema_version == 1, ERR_DECODE);
        check(p.network_id == self.policy.network_id, ERR_NETWORK);
        check(
            p.vault_id == env::current_account_id().as_str(),
            ERR_VAULT_ID,
        );
        check(
            p.policy_version == self.policy.policy_version,
            ERR_POLICY_VERSION,
        );
        check(p.rules_hash == self.policy.rules_hash, ERR_RULES_HASH);

        // FR-A07 (replay) before the approval lookup, because execution consumes
        // the approval: a replay must say ERR_ALREADY_USED, not ERR_NO_APPROVAL.
        check(!self.used_hashes.contains(&hash), ERR_ALREADY_USED);

        // FR-A06: authority.
        let owner = account(&p.owner_id);
        let agent = account(&p.agent_id);
        let token = account(&p.token_id);
        check(env::predecessor_account_id() == agent, ERR_AGENT_MISMATCH);
        let mut os = self.owner_today(&owner);
        check(os.agents.contains(&agent), ERR_AGENT_NOT_AUTHORISED);
        let now = env::block_timestamp_ms();
        match self.approvals.get(&hash) {
            Some(a) if a.owner == owner => check(now < a.expires_at_ms, ERR_EXPIRED),
            _ => fail(ERR_NO_APPROVAL),
        }

        // FR-A07: freshness.
        check(now < p.expires_at_ms, ERR_EXPIRED);
        check(
            p.expires_at_ms >= p.created_at_ms
                && p.expires_at_ms - p.created_at_ms <= self.policy.max_ttl_ms,
            ERR_TTL,
        );

        // FR-A08: economics.
        check(self.tokens.contains(&token), ERR_TOKEN);
        check(
            !p.payouts.is_empty() && p.payouts.len() <= self.policy.max_vendors as usize,
            ERR_PAYOUT_COUNT,
        );
        let mut vendors: Vec<AccountId> = Vec::with_capacity(p.payouts.len());
        let mut sum: u128 = 0;
        for (i, po) in p.payouts.iter().enumerate() {
            // Guard sorts payouts by vendor_id; strictly ascending also means distinct.
            if i > 0 {
                check(p.payouts[i - 1].vendor_id < po.vendor_id, ERR_DUP_VENDOR);
            }
            let v = account(&po.vendor_id);
            check(self.vendors.contains(&v), ERR_VENDOR);
            check(po.amount > 0, ERR_ZERO_AMOUNT);
            sum = sum
                .checked_add(po.amount)
                .unwrap_or_else(|| fail(ERR_TOTAL_MISMATCH));
            vendors.push(v);
        }
        check(sum == p.total, ERR_TOTAL_MISMATCH);
        check(
            p.total <= self.effective_max_basket(&os),
            ERR_OVER_BASKET_CAP,
        );
        let spent = os
            .spent_today
            .checked_add(p.total)
            .unwrap_or_else(|| fail(ERR_OVER_DAILY_CAP));
        check(spent <= self.effective_daily_cap(&os), ERR_OVER_DAILY_CAP);
        check(
            self.bal(&owner, &token).available >= p.total,
            ERR_INSUFFICIENT_AVAILABLE,
        );

        // FR-A10: effects.
        self.used_hashes.insert(hash);
        self.approvals.remove(&hash);
        self.bal_reserve(&owner, &token, p.total);
        os.spent_today = spent;
        let index = os.basket_count;
        os.basket_count += 1;
        self.owners.insert(owner.clone(), os);
        self.owner_baskets.insert((owner.clone(), index), hash);
        self.basket_count += 1;
        let payouts: Vec<Payout> = vendors
            .iter()
            .zip(p.payouts.iter())
            .map(|(v, po)| Payout {
                vendor: v.clone(),
                amount: po.amount,
                status: PayoutStatus::Executing,
            })
            .collect();
        self.baskets.insert(
            hash,
            Basket {
                basket_id: p.basket_id.clone(),
                owner: owner.clone(),
                agent: agent.clone(),
                token: token.clone(),
                total: p.total,
                day: today(),
                evidence_hash: p.evidence_hash,
                status: BasketStatus::Executing,
                created_at_ms: now,
                policy_version: p.policy_version,
                payouts: payouts.clone(),
            },
        );
        emit(
            "basket_executed",
            json!({
                "hash": hash_hex,
                "basket_id": p.basket_id,
                "owner": owner,
                "agent": agent,
                "token": token,
                "total": U128(p.total),
                "payouts": payouts.iter().map(|po| json!({ "vendor": po.vendor, "amount": U128(po.amount) })).collect::<Vec<_>>(),
                "evidence_hash": to_hex(&p.evidence_hash),
                "policy_version": p.policy_version,
            }),
        );

        // Interactions: one independent transfer + callback per vendor (FR-S01).
        for (i, po) in payouts.into_iter().enumerate() {
            ext_ft::ext(token.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(FT_TRANSFER_GAS)
                .ft_transfer(po.vendor, U128(po.amount), Some(p.basket_id.clone()))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_payout(hash_hex.clone(), i as u8),
                )
                .detach();
        }
        hash_hex
    }

    /// Settles one payout from its transfer's outcome (FR-S03 to FR-S05).
    /// Only Executing → Completed | Failed is allowed (ERR_BAD_STATE otherwise).
    #[private]
    pub fn on_payout(&mut self, hash_hex: String, index: u8) -> PayoutStatus {
        let ok = transfer_succeeded();
        self.settle_payout(&hash_hex, index, ok, "transfer_failed")
    }

    /// DAO-only fix for a payout whose callback never ran (it ran out of gas), at
    /// least 10 minutes after execution (FR-S08). `completed` says whether the
    /// vendor received the funds; check the token's transfer receipt first.
    #[payable]
    pub fn resolve_stuck_payout(
        &mut self,
        hash_hex: String,
        index: u8,
        completed: bool,
    ) -> PayoutStatus {
        self.assert_dao();
        let hash = hash_arg(&hash_hex);
        let b = self
            .baskets
            .get(&hash)
            .unwrap_or_else(|| fail(ERR_BAD_STATE));
        check(
            env::block_timestamp_ms().saturating_sub(b.created_at_ms) >= STUCK_PAYOUT_MS,
            ERR_BAD_STATE,
        );
        self.settle_payout(&hash_hex, index, completed, "resolved_by_dao")
    }
}

impl Vault {
    pub(crate) fn assert_dao(&self) {
        check(
            env::predecessor_account_id() == self.policy.dao_id,
            ERR_NOT_DAO,
        );
        assert_one_yocto();
    }

    fn settle_payout(&mut self, hash_hex: &str, index: u8, ok: bool, reason: &str) -> PayoutStatus {
        let hash = hash_arg(hash_hex);
        let mut b = self
            .baskets
            .get(&hash)
            .cloned()
            .unwrap_or_else(|| fail(ERR_BAD_STATE));
        let i = index as usize;
        check(i < b.payouts.len(), ERR_BAD_STATE);
        check(
            b.payouts[i].status == PayoutStatus::Executing,
            ERR_BAD_STATE,
        );
        let (vendor, amount) = (b.payouts[i].vendor.clone(), b.payouts[i].amount);

        if ok {
            self.bal_payout_done(&b.owner, &b.token, amount);
            b.payouts[i].status = PayoutStatus::Completed;
            emit(
                "payout_settled",
                json!({ "hash": hash_hex, "basket_id": b.basket_id, "index": index, "vendor": vendor, "amount": U128(amount) }),
            );
        } else {
            self.bal_payout_restore(&b.owner, &b.token, amount);
            // Give the daily allowance back if the basket was reserved today.
            let mut os = self.owners.get(&b.owner).cloned().unwrap_or_default();
            if os.day == b.day {
                os.spent_today = os.spent_today.saturating_sub(amount);
                self.owners.insert(b.owner.clone(), os);
            }
            b.payouts[i].status = PayoutStatus::Failed;
            emit(
                "payout_failed",
                json!({ "hash": hash_hex, "basket_id": b.basket_id, "index": index, "vendor": vendor, "amount": U128(amount), "reason": reason }),
            );
        }

        if let Some(status) = b.final_status() {
            b.status = status;
            emit(
                "basket_finalised",
                json!({ "hash": hash_hex, "basket_id": b.basket_id, "status": status }),
            );
        }
        let status = b.payouts[i].status;
        self.baskets.insert(hash, b);
        status
    }
}
