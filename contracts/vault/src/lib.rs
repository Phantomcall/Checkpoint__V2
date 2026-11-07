//! Checkpoint Vault (PRD §8.1–8.4, §10.1, §11.1).
//!
//! Holds owners' NEP-141 tokens and pays vendors only for baskets that Guard
//! signed and the owner approved on-chain. Every money rule is re-checked here,
//! so a compromised Guard or agent key is bounded by the Vault's own caps.
//!
//! Layout: `state` (types and storage), `deposits` (ft_on_transfer, withdraw),
//! `approvals` (set_agent, approve/revoke), `execute` (execute_basket and the
//! payout callbacks), `admin` (DAO and guardian), `solvency` (reconciliation),
//! `views`.

pub mod admin;
pub mod approvals;
pub mod deposits;
pub mod errors;
pub mod events;
pub mod execute;
pub mod hexutil;
pub mod payload;
pub mod solvency;
pub mod state;
pub mod views;

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableSet, LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

use crate::errors::{check, fail, ERR_BOUNDS, ERR_DECODE};
use crate::state::{Approval, Bal, Basket, OwnerState, Policy};

/// Hard bounds the DAO cannot exceed (FR-G03).
pub const MAX_VENDORS_BOUND: u8 = 6;
pub const MAX_TTL_MS_BOUND: u64 = 3_600_000;
/// At most this many agents per owner (FR-V06).
pub const MAX_AGENTS_PER_OWNER: usize = 3;
/// A payout still Executing after this long can be resolved by the DAO (FR-S08).
pub const STUCK_PAYOUT_MS: u64 = 10 * 60 * 1000;
pub const DAY_MS: u64 = 86_400_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Tokens,
    Vendors,
    Balances,
    Liabilities,
    InFlight,
    TokenEpoch,
    Owners,
    Approvals,
    UsedHashes,
    Baskets,
    OwnerBaskets,
}

/// Arguments to `new` (FR-V01). Amounts are U128 strings, `rules_hash` is hex
/// and `guard_pubkey` is base58 (an `ed25519:` prefix is accepted).
#[near(serializers = [json])]
#[derive(Clone)]
pub struct InitConfig {
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
    pub guardian: AccountId,
    pub dao_id: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    pub(crate) policy: Policy,
    pub(crate) tokens: IterableSet<AccountId>,
    pub(crate) vendors: IterableSet<AccountId>,
    /// (owner, token) → balances.
    pub(crate) balances: LookupMap<(AccountId, AccountId), Bal>,
    /// token → Σ owners (available + reserved + withdrawing). INV-1.
    pub(crate) liabilities: LookupMap<AccountId, u128>,
    /// token → Σ owners (reserved + withdrawing): funds with a transfer in flight.
    pub(crate) in_flight: LookupMap<AccountId, u128>,
    /// token → counter bumped on every balance change, so reconciliation can tell
    /// whether balances moved between its balance read and its callback.
    pub(crate) token_epoch: LookupMap<AccountId, u64>,
    pub(crate) owners: LookupMap<AccountId, OwnerState>,
    pub(crate) approvals: LookupMap<[u8; 32], Approval>,
    pub(crate) used_hashes: LookupSet<[u8; 32]>,
    pub(crate) baskets: LookupMap<[u8; 32], Basket>,
    /// (owner, index) → basket hash, index 0 = oldest. Count is in OwnerState.
    pub(crate) owner_baskets: LookupMap<(AccountId, u32), [u8; 32]>,
    pub(crate) basket_count: u64,
    pub(crate) owner_count: u64,
}

#[near]
impl Vault {
    #[init]
    pub fn new(config: InitConfig) -> Self {
        // #[init] already rejects a second call (the state exists).
        let rules_hash =
            hexutil::from_hex32(&config.rules_hash).unwrap_or_else(|| fail(ERR_DECODE));
        let guard_pubkey = parse_ed25519_pubkey(&config.guard_pubkey);
        validate_limits(
            config.max_basket_total.0,
            config.daily_cap.0,
            config.max_vendors,
            config.max_ttl_ms.0,
        );
        check(config.guard_key_version >= 1, ERR_BOUNDS);
        check(!config.network_id.is_empty(), ERR_BOUNDS);

        let mut tokens = IterableSet::new(StorageKey::Tokens);
        for t in config.tokens {
            tokens.insert(t);
        }
        let mut vendors = IterableSet::new(StorageKey::Vendors);
        for v in config.vendors {
            vendors.insert(v);
        }
        Self {
            policy: Policy {
                network_id: config.network_id,
                max_basket_total: config.max_basket_total.0,
                daily_cap: config.daily_cap.0,
                max_vendors: config.max_vendors,
                max_ttl_ms: config.max_ttl_ms.0,
                rules_hash,
                guard_pubkey,
                guard_key_version: config.guard_key_version,
                guard_key_disabled: false,
                guardian: config.guardian,
                dao_id: config.dao_id,
                policy_version: 1,
                paused: false,
                deficit: false,
            },
            tokens,
            vendors,
            balances: LookupMap::new(StorageKey::Balances),
            liabilities: LookupMap::new(StorageKey::Liabilities),
            in_flight: LookupMap::new(StorageKey::InFlight),
            token_epoch: LookupMap::new(StorageKey::TokenEpoch),
            owners: LookupMap::new(StorageKey::Owners),
            approvals: LookupMap::new(StorageKey::Approvals),
            used_hashes: LookupSet::new(StorageKey::UsedHashes),
            baskets: LookupMap::new(StorageKey::Baskets),
            owner_baskets: LookupMap::new(StorageKey::OwnerBaskets),
            basket_count: 0,
            owner_count: 0,
        }
    }
}

/// FR-G03 bounds, shared by `new` and `set_limits`.
pub(crate) fn validate_limits(
    max_basket_total: u128,
    daily_cap: u128,
    max_vendors: u8,
    max_ttl_ms: u64,
) {
    check(max_basket_total > 0, ERR_BOUNDS);
    check(max_basket_total <= daily_cap, ERR_BOUNDS);
    check((1..=MAX_VENDORS_BOUND).contains(&max_vendors), ERR_BOUNDS);
    check(max_ttl_ms > 0 && max_ttl_ms <= MAX_TTL_MS_BOUND, ERR_BOUNDS);
}

/// Base58 ed25519 public key, with or without the `ed25519:` prefix.
pub(crate) fn parse_ed25519_pubkey(s: &str) -> [u8; 32] {
    let raw = s.strip_prefix("ed25519:").unwrap_or(s);
    let bytes = near_sdk::bs58::decode(raw)
        .into_vec()
        .unwrap_or_else(|_| fail(ERR_DECODE));
    bytes.try_into().unwrap_or_else(|_| fail(ERR_DECODE))
}

pub(crate) fn today() -> u64 {
    env::block_timestamp_ms() / DAY_MS
}

#[cfg(test)]
mod tests;
