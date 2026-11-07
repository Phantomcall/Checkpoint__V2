//! Governance (FR-G01 to FR-G05). Policy setters need predecessor == dao_id and
//! 1 yoctoNEAR; each one bumps policy_version, so approvals and signatures made
//! under the old policy stop working (AT-07). The guardian can only pause and
//! disable the Guard key.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{assert_one_yocto, env, near, AccountId};

use crate::errors::{check, ERR_BOUNDS, ERR_DECODE, ERR_DEFICIT, ERR_NOT_GUARDIAN};
use crate::events::emit;
use crate::hexutil::{from_hex32, to_hex};
use crate::{parse_ed25519_pubkey, validate_limits, Vault, VaultExt};

#[near]
impl Vault {
    #[payable]
    pub fn set_vendor(&mut self, vendor_id: AccountId, allowed: bool) {
        self.assert_dao();
        let old = self.vendors.contains(&vendor_id);
        if allowed {
            self.vendors.insert(vendor_id.clone());
        } else {
            self.vendors.remove(&vendor_id);
        }
        self.policy_changed(&format!("vendor:{vendor_id}"), json!(old), json!(allowed));
    }

    #[payable]
    pub fn set_token(&mut self, token_id: AccountId, allowed: bool) {
        self.assert_dao();
        let old = self.tokens.contains(&token_id);
        if allowed {
            self.tokens.insert(token_id.clone());
        } else {
            self.tokens.remove(&token_id);
        }
        self.policy_changed(&format!("token:{token_id}"), json!(old), json!(allowed));
    }

    #[payable]
    pub fn set_limits(
        &mut self,
        max_basket_total: U128,
        daily_cap: U128,
        max_vendors: u8,
        max_ttl_ms: U64,
    ) {
        self.assert_dao();
        validate_limits(max_basket_total.0, daily_cap.0, max_vendors, max_ttl_ms.0);
        let p = &self.policy;
        let old = json!({
            "max_basket_total": U128(p.max_basket_total), "daily_cap": U128(p.daily_cap),
            "max_vendors": p.max_vendors, "max_ttl_ms": U64(p.max_ttl_ms),
        });
        let new = json!({
            "max_basket_total": max_basket_total, "daily_cap": daily_cap,
            "max_vendors": max_vendors, "max_ttl_ms": max_ttl_ms,
        });
        self.policy.max_basket_total = max_basket_total.0;
        self.policy.daily_cap = daily_cap.0;
        self.policy.max_vendors = max_vendors;
        self.policy.max_ttl_ms = max_ttl_ms.0;
        self.policy_changed("limits", old, new);
    }

    #[payable]
    pub fn set_rules_hash(&mut self, rules_hash: String) {
        self.assert_dao();
        let h = from_hex32(&rules_hash).unwrap_or_else(|| crate::errors::fail(ERR_DECODE));
        let old = to_hex(&self.policy.rules_hash);
        self.policy.rules_hash = h;
        self.policy_changed("rules_hash", json!(old), json!(rules_hash));
    }

    /// Rotate the Guard key. The version must strictly increase (FR-G03), and the
    /// new key starts enabled.
    #[payable]
    pub fn set_guard_key(&mut self, pubkey_b58: String, version: u32) {
        self.assert_dao();
        check(version > self.policy.guard_key_version, ERR_BOUNDS);
        let key = parse_ed25519_pubkey(&pubkey_b58);
        let old = json!({ "pubkey": near_sdk::bs58::encode(self.policy.guard_pubkey).into_string(), "version": self.policy.guard_key_version });
        self.policy.guard_pubkey = key;
        self.policy.guard_key_version = version;
        self.policy.guard_key_disabled = false;
        self.policy_changed(
            "guard_key",
            old,
            json!({ "pubkey": near_sdk::bs58::encode(key).into_string(), "version": version }),
        );
    }

    #[payable]
    pub fn set_guardian(&mut self, guardian_id: AccountId) {
        self.assert_dao();
        let old = self.policy.guardian.clone();
        self.policy.guardian = guardian_id.clone();
        self.policy_changed("guardian", json!(old), json!(guardian_id));
    }

    /// Hand admin rights to a new account, once, at setup: from the setup account
    /// to the Sputnik DAO (FR-G04).
    #[payable]
    pub fn transfer_admin(&mut self, new_dao_id: AccountId) {
        self.assert_dao();
        let old = self.policy.dao_id.clone();
        self.policy.dao_id = new_dao_id.clone();
        self.policy_changed("dao_id", json!(old), json!(new_dao_id));
    }

    /// Only the DAO can unpause, and only once no deficit is flagged.
    #[payable]
    pub fn unpause(&mut self) {
        self.assert_dao();
        check(!self.policy.deficit, ERR_DEFICIT);
        self.policy.paused = false;
        emit("unpaused", json!({ "by": env::predecessor_account_id() }));
    }

    /// Clear a deficit after it has been fixed (e.g. topped up). The Vault stays
    /// paused until the DAO also calls `unpause`.
    #[payable]
    pub fn clear_deficit(&mut self) {
        self.assert_dao();
        self.policy.deficit = false;
        emit(
            "deficit_cleared",
            json!({ "by": env::predecessor_account_id() }),
        );
    }

    /// Guardian or DAO. Blocks approve_basket and execute_basket only; deposits
    /// and withdrawals keep working (AT-16).
    #[payable]
    pub fn emergency_pause(&mut self, reason: String) {
        self.assert_guardian_or_dao();
        self.policy.paused = true;
        emit(
            "paused",
            json!({ "by": env::predecessor_account_id(), "reason": reason }),
        );
    }

    /// Guardian or DAO. Stops every basket signed with the current key until the
    /// DAO rotates it with set_guard_key.
    #[payable]
    pub fn disable_guard_key(&mut self) {
        self.assert_guardian_or_dao();
        self.policy.guard_key_disabled = true;
        emit(
            "guard_key_disabled",
            json!({ "by": env::predecessor_account_id(), "version": self.policy.guard_key_version }),
        );
    }
}

impl Vault {
    fn assert_guardian_or_dao(&self) {
        let c = env::predecessor_account_id();
        check(
            c == self.policy.guardian || c == self.policy.dao_id,
            ERR_NOT_GUARDIAN,
        );
        assert_one_yocto();
    }

    fn policy_changed(&mut self, field: &str, old: Value, new: Value) {
        self.policy.policy_version += 1;
        emit(
            "policy_updated",
            json!({ "field": field, "old": old, "new": new, "version": self.policy.policy_version }),
        );
    }
}
