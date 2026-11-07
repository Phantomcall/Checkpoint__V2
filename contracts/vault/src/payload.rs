//! Basket payload v1 (PRD §11.2). Field order is binding: it must match
//! packages/shared/src/payload.ts byte for byte, and the shared vector
//! (packages/shared/vectors/basket-v1.json) decides any disagreement.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::env;

/// Prepended before hashing, never serialised in the payload. 21 bytes.
pub const DOMAIN: &[u8] = b"CHECKPOINT_BASKET_V1\x00";

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PayoutV1 {
    pub vendor_id: String,
    pub amount: u128,
    pub line_count: u16,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct BasketPayloadV1 {
    pub schema_version: u8,
    pub network_id: String,
    pub vault_id: String,
    pub policy_version: u32,
    pub rules_hash: [u8; 32],
    pub guard_key_version: u32,
    pub basket_id: String,
    pub owner_id: String,
    pub agent_id: String,
    pub token_id: String,
    pub payouts: Vec<PayoutV1>,
    pub total: u128,
    pub evidence_hash: [u8; 32],
    pub nonce: u64,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

impl BasketPayloadV1 {
    /// Decode the exact bytes. Borsh's `try_from_slice` rejects trailing bytes.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        Self::try_from_slice(bytes).ok()
    }

    pub fn encode(&self) -> Vec<u8> {
        near_sdk::borsh::to_vec(self).expect("borsh encode")
    }
}

/// hash = sha256(DOMAIN ‖ payload bytes)
pub fn basket_hash(payload_bytes: &[u8]) -> [u8; 32] {
    let mut msg = Vec::with_capacity(DOMAIN.len() + payload_bytes.len());
    msg.extend_from_slice(DOMAIN);
    msg.extend_from_slice(payload_bytes);
    env::sha256_array(&msg)
}
