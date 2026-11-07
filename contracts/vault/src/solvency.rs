//! Reconciliation (FR-S07, P1). Anyone can ask the Vault to compare its token
//! balance with what it owes.
//!
//! Funds in flight (reserved or withdrawing) may already have left in a transfer
//! whose callback has not run, so the check is `balance + in_flight ≥ liabilities`.
//! If any balance moved between the balance read and the callback, the result is
//! stale and only `reconcile_skipped` is emitted.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Gas, Promise, PromiseError};

use crate::deposits::ext_ft;
use crate::events::emit;
use crate::{Vault, VaultExt};

const BALANCE_GAS: Gas = Gas::from_tgas(10);
const SOLVENCY_CB_GAS: Gas = Gas::from_tgas(10);

#[near]
impl Vault {
    pub fn check_solvency(&mut self, token_id: AccountId) -> Promise {
        let epoch = U64(self.epoch(&token_id));
        ext_ft::ext(token_id.clone())
            .with_static_gas(BALANCE_GAS)
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(SOLVENCY_CB_GAS)
                    .on_solvency(token_id, epoch),
            )
    }

    /// Returns true if solvent (or the check was skipped), false on a deficit.
    #[private]
    pub fn on_solvency(
        &mut self,
        token_id: AccountId,
        epoch: U64,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> bool {
        let Ok(balance) = balance else {
            emit(
                "reconcile_skipped",
                json!({ "token": token_id, "reason": "balance_read_failed" }),
            );
            return true;
        };
        if self.epoch(&token_id) != epoch.0 {
            emit(
                "reconcile_skipped",
                json!({ "token": token_id, "reason": "balances_moved" }),
            );
            return true;
        }
        let liabilities = self.liability(&token_id);
        let in_flight = self.in_flight_of(&token_id);
        let covered = balance.0.saturating_add(in_flight);
        if covered < liabilities {
            self.policy.deficit = true;
            self.policy.paused = true;
            emit(
                "deficit_detected",
                json!({ "token": token_id, "balance": balance, "liabilities": U128(liabilities), "in_flight": U128(in_flight) }),
            );
            false
        } else {
            emit(
                "reconciled",
                json!({ "token": token_id, "balance": balance, "liabilities": U128(liabilities), "in_flight": U128(in_flight), "surplus": U128(covered - liabilities) }),
            );
            true
        }
    }
}
