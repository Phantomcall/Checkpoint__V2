//! Deposits (FR-V03, FR-V04) and withdrawals (FR-V05, FR-S06).

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseError,
    PromiseOrValue,
};

use crate::errors::{
    check, fail, ERR_DEFICIT, ERR_GAS, ERR_INSUFFICIENT_AVAILABLE, ERR_ZERO_AMOUNT,
};
use crate::events::emit;
use crate::state::OwnerState;
use crate::{Vault, VaultExt};

/// Static gas for one `ft_transfer` (FR-A09; measured on Day 3, see docs/gas.md).
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(10);
/// Static gas for one `on_payout` / `on_withdraw` callback.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(15);
/// Gas `withdraw` itself needs on top of the transfer and the callback.
pub const WITHDRAW_BASE_GAS: Gas = Gas::from_tgas(5);

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[near]
impl Vault {
    /// NEP-141 receiver. Credits `sender_id` only (the `msg` is ignored in v1).
    /// Returns the full amount, which the token refunds, when the caller is not an
    /// allowlisted token, the amount is zero, or a deficit is flagged.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        #[allow(unused_variables)] msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if !self.tokens.contains(&token) || amount.0 == 0 || self.policy.deficit {
            return PromiseOrValue::Value(amount);
        }
        if !self.owners.contains_key(&sender_id) {
            self.owners.insert(sender_id.clone(), OwnerState::default());
            self.owner_count += 1;
        }
        self.bal_credit(&sender_id, &token, amount.0);
        emit(
            "deposit",
            json!({ "owner": sender_id, "token": token, "amount": amount }),
        );
        PromiseOrValue::Value(U128(0))
    }

    /// Withdraw `amount` of `token_id` to the caller. Needs exactly 1 yoctoNEAR.
    /// Allowed while paused, refused while a deficit is flagged.
    #[payable]
    pub fn withdraw(&mut self, token_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        check(!self.policy.deficit, ERR_DEFICIT);
        check(amount.0 > 0, ERR_ZERO_AMOUNT);
        let needed = WITHDRAW_BASE_GAS
            .saturating_add(FT_TRANSFER_GAS)
            .saturating_add(CALLBACK_GAS);
        check(env::prepaid_gas() >= needed, ERR_GAS);
        let owner = env::predecessor_account_id();
        if self.bal(&owner, &token_id).available < amount.0 {
            fail(ERR_INSUFFICIENT_AVAILABLE)
        }
        self.bal_withdraw_start(&owner, &token_id, amount.0);
        emit(
            "withdraw_requested",
            json!({ "owner": owner, "token": token_id, "amount": amount }),
        );
        ext_ft::ext(token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(owner.clone(), amount, None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdraw(owner, token_id, amount),
            )
    }

    /// Settles a withdrawal from the transfer's outcome. Never panics on the
    /// normal paths: success burns `withdrawing`, failure returns it to `available`.
    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, token_id: AccountId, amount: U128) -> bool {
        let ok = transfer_succeeded();
        if ok {
            self.bal_withdraw_done(&owner, &token_id, amount.0);
            emit(
                "withdraw_settled",
                json!({ "owner": owner, "token": token_id, "amount": amount }),
            );
        } else {
            self.bal_withdraw_restore(&owner, &token_id, amount.0);
            emit(
                "withdraw_failed",
                json!({ "owner": owner, "token": token_id, "amount": amount, "reason": "transfer_failed" }),
            );
        }
        ok
    }
}

/// Outcome of the single `ft_transfer` this callback is attached to. A
/// successful transfer returns no value; anything other than `Failed` counts as
/// success. Reads at most 16 bytes, so a hostile return value cannot burn gas.
pub(crate) fn transfer_succeeded() -> bool {
    if env::promise_results_count() != 1 {
        return false;
    }
    !matches!(
        env::promise_result_checked(0, 16),
        Err(PromiseError::Failed)
    )
}
