//! Stable error strings (PRD §11.1). Tests, Guard, the agents and the web app
//! match on these, so never rename one.

pub const ERR_PAUSED: &str = "ERR_PAUSED";
pub const ERR_DECODE: &str = "ERR_DECODE";
pub const ERR_BAD_SIGNATURE: &str = "ERR_BAD_SIGNATURE";
pub const ERR_KEY_VERSION: &str = "ERR_KEY_VERSION";
pub const ERR_NETWORK: &str = "ERR_NETWORK";
pub const ERR_VAULT_ID: &str = "ERR_VAULT_ID";
pub const ERR_POLICY_VERSION: &str = "ERR_POLICY_VERSION";
pub const ERR_RULES_HASH: &str = "ERR_RULES_HASH";
pub const ERR_AGENT_MISMATCH: &str = "ERR_AGENT_MISMATCH";
pub const ERR_AGENT_NOT_AUTHORISED: &str = "ERR_AGENT_NOT_AUTHORISED";
pub const ERR_NO_APPROVAL: &str = "ERR_NO_APPROVAL";
pub const ERR_EXPIRED: &str = "ERR_EXPIRED";
pub const ERR_TTL: &str = "ERR_TTL";
pub const ERR_ALREADY_USED: &str = "ERR_ALREADY_USED";
pub const ERR_TOKEN: &str = "ERR_TOKEN";
pub const ERR_VENDOR: &str = "ERR_VENDOR";
pub const ERR_DUP_VENDOR: &str = "ERR_DUP_VENDOR";
pub const ERR_PAYOUT_COUNT: &str = "ERR_PAYOUT_COUNT";
pub const ERR_ZERO_AMOUNT: &str = "ERR_ZERO_AMOUNT";
pub const ERR_TOTAL_MISMATCH: &str = "ERR_TOTAL_MISMATCH";
pub const ERR_OVER_BASKET_CAP: &str = "ERR_OVER_BASKET_CAP";
pub const ERR_OVER_DAILY_CAP: &str = "ERR_OVER_DAILY_CAP";
pub const ERR_INSUFFICIENT_AVAILABLE: &str = "ERR_INSUFFICIENT_AVAILABLE";
pub const ERR_GAS: &str = "ERR_GAS";
pub const ERR_BAD_STATE: &str = "ERR_BAD_STATE";
pub const ERR_NOT_DAO: &str = "ERR_NOT_DAO";
pub const ERR_NOT_GUARDIAN: &str = "ERR_NOT_GUARDIAN";
pub const ERR_BOUNDS: &str = "ERR_BOUNDS";
pub const ERR_DEFICIT: &str = "ERR_DEFICIT";
/// Additive (not in PRD §11.1): the caller has never deposited, so it has no owner record.
pub const ERR_UNKNOWN_OWNER: &str = "ERR_UNKNOWN_OWNER";

/// Abort the call with a stable error string. Nothing the call changed is kept.
pub fn fail(code: &str) -> ! {
    near_sdk::env::panic_str(code)
}

pub fn check(cond: bool, code: &str) {
    if !cond {
        fail(code)
    }
}
