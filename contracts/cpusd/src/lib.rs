//! cpUSD: the Checkpoint test token (NEP-141 + NEP-145), 6 decimals, no value.
//!
//! The owner can mint. With the `sandbox` cargo feature (never deployed to
//! testnet) there are two fault switches the Vault tests need:
//! `set_fail_transfers(true)` makes `ft_transfer` panic (withdraw-failure tests),
//! and `burn_from` removes tokens from an account (the AT-17 deficit test).

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 6;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Cpusd {
    token: FungibleToken,
    owner_id: AccountId,
    fail_transfers: bool,
}

#[near]
impl Cpusd {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let mut token = FungibleToken::new(StorageKey::Token);
        token.internal_register_account(&owner_id);
        Self {
            token,
            owner_id,
            fail_transfers: false,
        }
    }

    /// Owner only. The receiver must be storage-registered.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.assert_owner();
        if !self.token.accounts.contains_key(&account_id) {
            env::panic_str("The account is not registered");
        }
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("cpUSD test mint (no value)"),
        }
        .emit();
    }

    pub fn owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }

    #[cfg(feature = "sandbox")]
    pub fn set_fail_transfers(&mut self, fail: bool) {
        self.assert_owner();
        self.fail_transfers = fail;
    }

    #[cfg(feature = "sandbox")]
    pub fn burn_from(&mut self, account_id: AccountId, amount: U128) {
        self.assert_owner();
        self.token.internal_withdraw(&account_id, amount.0);
    }
}

impl Cpusd {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
    }
}

#[near]
impl FungibleTokenCore for Cpusd {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            !self.fail_transfers,
            "cpUSD: transfers disabled (sandbox fault switch)"
        );
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Cpusd {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Cpusd {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Cpusd {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Checkpoint test USD (no value)".to_string(),
            symbol: "cpUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}
