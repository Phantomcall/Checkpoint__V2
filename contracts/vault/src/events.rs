//! NEP-297 events with the `EVENT_JSON:` prefix (PRD §11.3). Amounts are strings.

use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub const STANDARD: &str = "checkpoint";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let body = json!({ "standard": STANDARD, "version": VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
