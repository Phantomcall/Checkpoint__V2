//! Views (FR-V08, FR-S09). JSON shapes match packages/shared/src/vault-views.ts:
//! amounts and millisecond times are strings, hashes are lowercase hex and the
//! Guard key is base58.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

use crate::hexutil::{from_hex32, to_hex};
use crate::state::{Basket, BasketStatus, PayoutStatus};
use crate::{today, Vault, VaultExt};

pub const MAX_PAGE: u32 = 50;

#[near(serializers = [json])]
pub struct PolicyView {
    pub network_id: String,
    pub tokens: Vec<AccountId>,
    pub vendors: Vec<AccountId>,
    pub max_basket_total: U128,
    pub daily_cap: U128,
    pub max_vendors: u8,
    pub max_ttl_ms: U64,
    pub rules_hash: String,
    pub guard_pubkey: String,
    pub guard_key_version: u32,
    pub guard_key_disabled: bool,
    pub guardian: AccountId,
    pub dao_id: AccountId,
    pub policy_version: u32,
    pub paused: bool,
    pub deficit: bool,
}

#[near(serializers = [json])]
pub struct StatusView {
    pub paused: bool,
    pub deficit: bool,
    pub policy_version: u32,
    pub guard_key_disabled: bool,
    pub basket_count: U64,
    pub owner_count: U64,
}

#[near(serializers = [json])]
pub struct BalanceView {
    pub available: U128,
    pub reserved: U128,
    pub withdrawing: U128,
}

#[near(serializers = [json])]
pub struct OwnerStateView {
    pub agents: Vec<AccountId>,
    /// Today's UTC day index; spent_today is for this day.
    pub day: U64,
    pub spent_today: U128,
    /// Effective limits: the minimum of the owner's and the global limit.
    pub max_basket: U128,
    pub daily_cap: U128,
    pub basket_count: u32,
}

#[near(serializers = [json])]
pub struct ApprovalView {
    pub owner: AccountId,
    pub expires_at_ms: U64,
    pub created_at_ms: U64,
}

#[near(serializers = [json])]
pub struct PayoutView {
    pub vendor: AccountId,
    pub amount: U128,
    pub status: PayoutStatus,
}

#[near(serializers = [json])]
pub struct BasketView {
    pub hash: String,
    pub basket_id: String,
    pub owner: AccountId,
    pub agent: AccountId,
    pub token: AccountId,
    pub total: U128,
    pub day: U64,
    pub evidence_hash: String,
    pub status: BasketStatus,
    pub created_at_ms: U64,
    pub policy_version: u32,
    pub payouts: Vec<PayoutView>,
}

fn basket_view(hash: &[u8; 32], b: &Basket) -> BasketView {
    BasketView {
        hash: to_hex(hash),
        basket_id: b.basket_id.clone(),
        owner: b.owner.clone(),
        agent: b.agent.clone(),
        token: b.token.clone(),
        total: U128(b.total),
        day: U64(b.day),
        evidence_hash: to_hex(&b.evidence_hash),
        status: b.status,
        created_at_ms: U64(b.created_at_ms),
        policy_version: b.policy_version,
        payouts: b
            .payouts
            .iter()
            .map(|p| PayoutView {
                vendor: p.vendor.clone(),
                amount: U128(p.amount),
                status: p.status,
            })
            .collect(),
    }
}

#[near]
impl Vault {
    pub fn get_policy(&self) -> PolicyView {
        let p = &self.policy;
        PolicyView {
            network_id: p.network_id.clone(),
            tokens: self.tokens.iter().cloned().collect(),
            vendors: self.vendors.iter().cloned().collect(),
            max_basket_total: U128(p.max_basket_total),
            daily_cap: U128(p.daily_cap),
            max_vendors: p.max_vendors,
            max_ttl_ms: U64(p.max_ttl_ms),
            rules_hash: to_hex(&p.rules_hash),
            guard_pubkey: near_sdk::bs58::encode(p.guard_pubkey).into_string(),
            guard_key_version: p.guard_key_version,
            guard_key_disabled: p.guard_key_disabled,
            guardian: p.guardian.clone(),
            dao_id: p.dao_id.clone(),
            policy_version: p.policy_version,
            paused: p.paused,
            deficit: p.deficit,
        }
    }

    pub fn get_status(&self) -> StatusView {
        StatusView {
            paused: self.policy.paused,
            deficit: self.policy.deficit,
            policy_version: self.policy.policy_version,
            guard_key_disabled: self.policy.guard_key_disabled,
            basket_count: U64(self.basket_count),
            owner_count: U64(self.owner_count),
        }
    }

    pub fn get_balance(&self, owner_id: AccountId, token_id: AccountId) -> BalanceView {
        let b = self.bal(&owner_id, &token_id);
        BalanceView {
            available: U128(b.available),
            reserved: U128(b.reserved),
            withdrawing: U128(b.withdrawing),
        }
    }

    pub fn get_owner_state(&self, owner_id: AccountId) -> OwnerStateView {
        let s = self.owner_today(&owner_id);
        OwnerStateView {
            agents: s.agents.clone(),
            day: U64(today()),
            spent_today: U128(s.spent_today),
            max_basket: U128(self.effective_max_basket(&s)),
            daily_cap: U128(self.effective_daily_cap(&s)),
            basket_count: s.basket_count,
        }
    }

    pub fn get_liabilities(&self, token_id: AccountId) -> U128 {
        U128(self.liability(&token_id))
    }

    pub fn get_approval(&self, hash_hex: String) -> Option<ApprovalView> {
        let h = from_hex32(&hash_hex)?;
        self.approvals.get(&h).map(|a| ApprovalView {
            owner: a.owner.clone(),
            expires_at_ms: U64(a.expires_at_ms),
            created_at_ms: U64(a.created_at_ms),
        })
    }

    pub fn get_basket(&self, hash_hex: String) -> Option<BasketView> {
        let h = from_hex32(&hash_hex)?;
        self.baskets.get(&h).map(|b| basket_view(&h, b))
    }

    /// The owner's baskets, newest first. `from_index` 0 is the newest; `limit` ≤ 50.
    pub fn get_baskets(
        &self,
        owner_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<BasketView> {
        let count = self.owners.get(&owner_id).map_or(0, |s| s.basket_count);
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(20).min(MAX_PAGE);
        (from..count.min(from.saturating_add(limit)))
            .filter_map(|k| {
                let idx = count - 1 - k;
                let h = self.owner_baskets.get(&(owner_id.clone(), idx))?;
                self.baskets.get(h).map(|b| basket_view(h, b))
            })
            .collect()
    }
}
