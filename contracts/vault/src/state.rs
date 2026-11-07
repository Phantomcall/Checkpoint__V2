//! Stored types (PRD §10.1) and the only code that moves balances.
//!
//! Every change to `available`, `reserved` or `withdrawing` goes through one of
//! the `Vault::bal_*` helpers below, which keep `liabilities` and `in_flight` in
//! step. That is what makes INV-1 hold by construction.

use near_sdk::{near, AccountId};

use crate::errors::{fail, ERR_BAD_STATE, ERR_INSUFFICIENT_AVAILABLE};
use crate::{today, Vault};

#[near(serializers = [borsh])]
pub struct Policy {
    pub network_id: String,
    pub max_basket_total: u128,
    pub daily_cap: u128,
    pub max_vendors: u8,
    pub max_ttl_ms: u64,
    pub rules_hash: [u8; 32],
    pub guard_pubkey: [u8; 32],
    pub guard_key_version: u32,
    pub guard_key_disabled: bool,
    pub guardian: AccountId,
    pub dao_id: AccountId,
    pub policy_version: u32,
    pub paused: bool,
    pub deficit: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default, Debug, PartialEq, Eq)]
pub struct Bal {
    pub available: u128,
    pub reserved: u128,
    pub withdrawing: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct OwnerState {
    pub agents: Vec<AccountId>,
    /// UTC day index of `spent_today`.
    pub day: u64,
    pub spent_today: u128,
    pub max_basket: Option<u128>,
    pub daily_cap: Option<u128>,
    pub basket_count: u32,
}

impl OwnerState {
    /// Today's spend, treating a stale day as zero.
    pub fn spent_on(&self, day: u64) -> u128 {
        if self.day == day {
            self.spent_today
        } else {
            0
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Approval {
    pub owner: AccountId,
    pub expires_at_ms: u64,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BasketStatus {
    Executing,
    Completed,
    PartiallyPaid,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    Executing,
    Completed,
    Failed,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Payout {
    pub vendor: AccountId,
    pub amount: u128,
    pub status: PayoutStatus,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Basket {
    pub basket_id: String,
    pub owner: AccountId,
    pub agent: AccountId,
    pub token: AccountId,
    pub total: u128,
    pub day: u64,
    pub evidence_hash: [u8; 32],
    pub status: BasketStatus,
    pub created_at_ms: u64,
    pub policy_version: u32,
    pub payouts: Vec<Payout>,
}

impl Basket {
    /// The final basket status once no payout is Executing (FR-S02), else None.
    pub fn final_status(&self) -> Option<BasketStatus> {
        if self
            .payouts
            .iter()
            .any(|p| p.status == PayoutStatus::Executing)
        {
            return None;
        }
        let ok = self
            .payouts
            .iter()
            .filter(|p| p.status == PayoutStatus::Completed)
            .count();
        Some(if ok == self.payouts.len() {
            BasketStatus::Completed
        } else if ok == 0 {
            BasketStatus::Failed
        } else {
            BasketStatus::PartiallyPaid
        })
    }
}

fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| fail(ERR_BAD_STATE))
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| fail(ERR_BAD_STATE))
}

impl Vault {
    pub(crate) fn bal(&self, owner: &AccountId, token: &AccountId) -> Bal {
        self.balances
            .get(&(owner.clone(), token.clone()))
            .cloned()
            .unwrap_or_default()
    }

    pub(crate) fn liability(&self, token: &AccountId) -> u128 {
        self.liabilities.get(token).copied().unwrap_or(0)
    }

    pub(crate) fn in_flight_of(&self, token: &AccountId) -> u128 {
        self.in_flight.get(token).copied().unwrap_or(0)
    }

    pub(crate) fn epoch(&self, token: &AccountId) -> u64 {
        self.token_epoch.get(token).copied().unwrap_or(0)
    }

    fn put_bal(&mut self, owner: &AccountId, token: &AccountId, b: Bal) {
        self.balances.insert((owner.clone(), token.clone()), b);
        let e = self.epoch(token) + 1;
        self.token_epoch.insert(token.clone(), e);
    }

    fn adjust(&mut self, token: &AccountId, liab: i8, flight: i8, amount: u128) {
        if liab != 0 {
            let l = self.liability(token);
            self.liabilities.insert(
                token.clone(),
                if liab > 0 {
                    add(l, amount)
                } else {
                    sub(l, amount)
                },
            );
        }
        if flight != 0 {
            let f = self.in_flight_of(token);
            self.in_flight.insert(
                token.clone(),
                if flight > 0 {
                    add(f, amount)
                } else {
                    sub(f, amount)
                },
            );
        }
    }

    /// Deposit: available += amount, liabilities += amount.
    pub(crate) fn bal_credit(&mut self, owner: &AccountId, token: &AccountId, amount: u128) {
        let mut b = self.bal(owner, token);
        b.available = add(b.available, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, 1, 0, amount);
    }

    /// Basket reservation: available → reserved.
    pub(crate) fn bal_reserve(&mut self, owner: &AccountId, token: &AccountId, amount: u128) {
        let mut b = self.bal(owner, token);
        if b.available < amount {
            fail(ERR_INSUFFICIENT_AVAILABLE)
        }
        b.available -= amount;
        b.reserved = add(b.reserved, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, 0, 1, amount);
    }

    /// Payout succeeded: reserved leaves the Vault.
    pub(crate) fn bal_payout_done(&mut self, owner: &AccountId, token: &AccountId, amount: u128) {
        let mut b = self.bal(owner, token);
        b.reserved = sub(b.reserved, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, -1, -1, amount);
    }

    /// Payout failed: reserved → available.
    pub(crate) fn bal_payout_restore(
        &mut self,
        owner: &AccountId,
        token: &AccountId,
        amount: u128,
    ) {
        let mut b = self.bal(owner, token);
        b.reserved = sub(b.reserved, amount);
        b.available = add(b.available, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, 0, -1, amount);
    }

    /// Withdrawal started: available → withdrawing.
    pub(crate) fn bal_withdraw_start(
        &mut self,
        owner: &AccountId,
        token: &AccountId,
        amount: u128,
    ) {
        let mut b = self.bal(owner, token);
        if b.available < amount {
            fail(ERR_INSUFFICIENT_AVAILABLE)
        }
        b.available -= amount;
        b.withdrawing = add(b.withdrawing, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, 0, 1, amount);
    }

    /// Withdrawal succeeded: withdrawing leaves the Vault.
    pub(crate) fn bal_withdraw_done(&mut self, owner: &AccountId, token: &AccountId, amount: u128) {
        let mut b = self.bal(owner, token);
        b.withdrawing = sub(b.withdrawing, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, -1, -1, amount);
    }

    /// Withdrawal failed: withdrawing → available.
    pub(crate) fn bal_withdraw_restore(
        &mut self,
        owner: &AccountId,
        token: &AccountId,
        amount: u128,
    ) {
        let mut b = self.bal(owner, token);
        b.withdrawing = sub(b.withdrawing, amount);
        b.available = add(b.available, amount);
        self.put_bal(owner, token, b);
        self.adjust(token, 0, -1, amount);
    }

    /// The owner's state with `spent_today` rolled over to today.
    pub(crate) fn owner_today(&self, owner: &AccountId) -> OwnerState {
        let mut s = self.owners.get(owner).cloned().unwrap_or_default();
        let d = today();
        if s.day != d {
            s.day = d;
            s.spent_today = 0;
        }
        s
    }

    pub(crate) fn effective_max_basket(&self, s: &OwnerState) -> u128 {
        s.max_basket.map_or(self.policy.max_basket_total, |m| {
            m.min(self.policy.max_basket_total)
        })
    }

    pub(crate) fn effective_daily_cap(&self, s: &OwnerState) -> u128 {
        s.daily_cap
            .map_or(self.policy.daily_cap, |m| m.min(self.policy.daily_cap))
    }
}
