//! Owner actions: agent authorisation (FR-V06), owner limits (FR-V07) and
//! human approvals (FR-A01, FR-A02). All need exactly 1 yoctoNEAR, which forces a
//! full-access-key signature in the wallet.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, AccountId};

use crate::errors::{
    check, fail, ERR_ALREADY_USED, ERR_BAD_STATE, ERR_BOUNDS, ERR_EXPIRED, ERR_NO_APPROVAL,
    ERR_PAUSED, ERR_TTL, ERR_UNKNOWN_OWNER,
};
use crate::events::emit;
use crate::hexutil::hash_arg;
use crate::state::Approval;
use crate::{Vault, VaultExt, MAX_AGENTS_PER_OWNER};

#[near]
impl Vault {
    /// Authorise (or remove) an agent for the caller's funds. At most 3 per owner.
    /// The caller must have deposited first, so strangers cannot fill Vault storage.
    #[payable]
    pub fn set_agent(&mut self, agent_id: AccountId, enabled: bool) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let mut s = self
            .owners
            .get(&owner)
            .cloned()
            .unwrap_or_else(|| fail(ERR_UNKNOWN_OWNER));
        let present = s.agents.contains(&agent_id);
        if enabled && !present {
            check(s.agents.len() < MAX_AGENTS_PER_OWNER, ERR_BOUNDS);
            s.agents.push(agent_id.clone());
        } else if !enabled && present {
            s.agents.retain(|a| a != &agent_id);
        }
        self.owners.insert(owner.clone(), s);
        emit(
            "agent_set",
            json!({ "owner": owner, "agent": agent_id, "enabled": enabled }),
        );
    }

    /// Owner-set limits below the global ones (FR-V07). `None` clears a limit.
    /// The effective limit is the minimum of the owner's and the global limit.
    #[payable]
    pub fn set_owner_limits(&mut self, max_basket: Option<U128>, daily_cap: Option<U128>) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let mut s = self
            .owners
            .get(&owner)
            .cloned()
            .unwrap_or_else(|| fail(ERR_UNKNOWN_OWNER));
        if let Some(m) = max_basket {
            check(m.0 > 0 && m.0 <= self.policy.max_basket_total, ERR_BOUNDS);
        }
        if let Some(d) = daily_cap {
            check(d.0 > 0 && d.0 <= self.policy.daily_cap, ERR_BOUNDS);
        }
        if let (Some(m), Some(d)) = (max_basket, daily_cap) {
            check(m.0 <= d.0, ERR_BOUNDS);
        }
        s.max_basket = max_basket.map(|v| v.0);
        s.daily_cap = daily_cap.map(|v| v.0);
        self.owners.insert(owner.clone(), s);
        emit(
            "owner_limits_set",
            json!({ "owner": owner, "max_basket": max_basket, "daily_cap": daily_cap }),
        );
    }

    /// Approve the exact basket whose hash Guard signed. A repeat approval of the
    /// same hash by the same owner only moves the expiry.
    #[payable]
    pub fn approve_basket(&mut self, hash_hex: String, expires_at_ms: U64) {
        assert_one_yocto();
        check(!self.policy.paused, ERR_PAUSED);
        let hash = hash_arg(&hash_hex);
        let owner = env::predecessor_account_id();
        check(self.owners.contains_key(&owner), ERR_UNKNOWN_OWNER);
        check(!self.used_hashes.contains(&hash), ERR_ALREADY_USED);
        let now = env::block_timestamp_ms();
        check(expires_at_ms.0 > now, ERR_EXPIRED);
        check(expires_at_ms.0 - now <= self.policy.max_ttl_ms, ERR_TTL);
        let created_at_ms = match self.approvals.get(&hash) {
            Some(a) if a.owner != owner => fail(ERR_BAD_STATE),
            Some(a) => a.created_at_ms,
            None => now,
        };
        self.approvals.insert(
            hash,
            Approval {
                owner: owner.clone(),
                expires_at_ms: expires_at_ms.0,
                created_at_ms,
            },
        );
        emit(
            "basket_approved",
            json!({ "hash": hash_hex, "owner": owner, "expires_at_ms": expires_at_ms }),
        );
    }

    /// Remove the caller's approval. Execution afterwards fails ERR_NO_APPROVAL.
    #[payable]
    pub fn revoke_approval(&mut self, hash_hex: String) {
        assert_one_yocto();
        let hash = hash_arg(&hash_hex);
        let owner = env::predecessor_account_id();
        match self.approvals.get(&hash) {
            Some(a) if a.owner == owner => {}
            _ => fail(ERR_NO_APPROVAL),
        }
        self.approvals.remove(&hash);
        emit(
            "approval_revoked",
            json!({ "hash": hash_hex, "owner": owner }),
        );
    }
}
