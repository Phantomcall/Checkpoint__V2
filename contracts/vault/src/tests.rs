//! Unit tests on the mocked blockchain: the shared vector, every ERR_ path of
//! execute_basket (table-driven), callbacks, approvals, admin and INV-1.
//! Cross-contract behaviour (real transfers, gas) is in contracts/sandbox-tests.

use std::panic::{catch_unwind, AssertUnwindSafe};

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseResult, RuntimeFeesConfig};

use crate::hexutil::{from_hex32, to_hex};
use crate::payload::{basket_hash, BasketPayloadV1, PayoutV1};
use crate::state::{BasketStatus, PayoutStatus};
use crate::{InitConfig, Vault};

const VAULT: &str = "vault.cpdemo.testnet";
const TOKEN: &str = "cpusd.cpdemo.testnet";
const OWNER: &str = "owner-demo.cpdemo.testnet";
const AGENT: &str = "agent.cpdemo.testnet";
const DAO: &str = "cpdemo.testnet";
const GUARDIAN: &str = "guardian.cpdemo.testnet";
const T0_MS: u64 = 1_762_400_000_000; // 6 Nov 2025-ish; any fixed time works
const CPUSD: u128 = 1_000_000; // 6 decimals
const RULES: [u8; 32] = [7u8; 32];

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn vendor(n: u8) -> AccountId {
    acc(&format!("vendor-0{n}.cpdemo.testnet"))
}

fn guard_key() -> SigningKey {
    SigningKey::from_bytes(&[42u8; 32])
}

struct World {
    v: Vault,
    now_ms: u64,
}

impl World {
    fn ctx(&self, who: &str, deposit: u128, gas_tgas: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(VAULT))
            .predecessor_account_id(acc(who))
            .signer_account_id(acc(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(gas_tgas))
            .block_timestamp(self.now_ms * 1_000_000);
        b
    }
    fn as_(&self, who: &str, deposit: u128) {
        testing_env!(self.ctx(who, deposit, 300).build());
    }
    fn as_gas(&self, who: &str, gas_tgas: u64) {
        testing_env!(self.ctx(who, 0, gas_tgas).build());
    }
    fn callback(&self, result: PromiseResult) {
        testing_env!(
            self.ctx(VAULT, 0, 300).build(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![result],
        );
    }

    fn new() -> Self {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(VAULT))
            .predecessor_account_id(acc(DAO))
            .block_timestamp(T0_MS * 1_000_000);
        // Fresh storage: testing_env! carries storage over, and each World must start empty.
        near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
            b.build(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            vec![],
            Default::default(),
            Default::default(),
            None,
        ));
        let v = Vault::new(config());
        let mut w = World { v, now_ms: T0_MS };
        // Owner deposits 500 cpUSD and authorises the agent.
        w.as_(TOKEN, 0);
        let _ =
            w.v.ft_on_transfer(acc(OWNER), U128(500 * CPUSD), String::new());
        w.as_(OWNER, 1);
        w.v.set_agent(acc(AGENT), true);
        w
    }

    fn approve(&mut self, p: &BasketPayloadV1) -> String {
        let h = to_hex(&basket_hash(&p.encode()));
        self.as_(OWNER, 1);
        self.v
            .approve_basket(h.clone(), U64(self.now_ms + 10 * 60 * 1000));
        h
    }

    fn execute(&mut self, p: &BasketPayloadV1) -> String {
        let (b, s) = sign(p);
        self.as_(AGENT, 0);
        self.v.execute_basket(b, s)
    }

    fn inv1(&self) {
        let l = self.v.get_liabilities(acc(TOKEN)).0;
        let b = self.v.get_balance(acc(OWNER), acc(TOKEN));
        assert_eq!(
            l,
            b.available.0 + b.reserved.0 + b.withdrawing.0,
            "INV-1: liabilities = Σ balances"
        );
    }
}

fn config() -> InitConfig {
    InitConfig {
        network_id: "testnet".into(),
        tokens: vec![acc(TOKEN)],
        vendors: vec![vendor(1), vendor(2), vendor(3), vendor(4), vendor(6)],
        max_basket_total: U128(500 * CPUSD),
        daily_cap: U128(1_000 * CPUSD),
        max_vendors: 4,
        max_ttl_ms: U64(30 * 60 * 1000),
        rules_hash: to_hex(&RULES),
        guard_pubkey: near_sdk::bs58::encode(guard_key().verifying_key().to_bytes()).into_string(),
        guard_key_version: 1,
        guardian: acc(GUARDIAN),
        dao_id: acc(DAO),
    }
}

fn payload(now_ms: u64) -> BasketPayloadV1 {
    BasketPayloadV1 {
        schema_version: 1,
        network_id: "testnet".into(),
        vault_id: VAULT.into(),
        policy_version: 1,
        rules_hash: RULES,
        guard_key_version: 1,
        basket_id: "3f2c1d4e-8a7b-4c6d-9e0f-1a2b3c4d5e6f".into(),
        owner_id: OWNER.into(),
        agent_id: AGENT.into(),
        token_id: TOKEN.into(),
        payouts: vec![
            PayoutV1 {
                vendor_id: vendor(2).to_string(),
                amount: 23 * CPUSD,
                line_count: 1,
            },
            PayoutV1 {
                vendor_id: vendor(6).to_string(),
                amount: 10 * CPUSD,
                line_count: 1,
            },
        ],
        total: 33 * CPUSD,
        evidence_hash: [9u8; 32],
        nonce: 1,
        created_at_ms: now_ms,
        expires_at_ms: now_ms + 15 * 60 * 1000,
    }
}

fn sign(p: &BasketPayloadV1) -> (Base64VecU8, Base64VecU8) {
    let bytes = p.encode();
    let sig = guard_key().sign(&basket_hash(&bytes));
    (Base64VecU8(bytes), Base64VecU8(sig.to_bytes().to_vec()))
}

/// Run `f`, expecting a panic whose message contains `code`.
fn expect_err(code: &str, f: impl FnOnce()) {
    let r = catch_unwind(AssertUnwindSafe(f));
    let msg = match r {
        Ok(()) => panic!("expected {code}, but the call succeeded"),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    };
    assert!(msg.contains(code), "expected {code}, got: {msg}");
}

// ---------------------------------------------------------------- vector (H1)

#[test]
fn shared_vector_matches_rust_encoding_hash_and_signature() {
    testing_env!(VMContextBuilder::new().build());
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/shared/vectors/basket-v1.json"
    ))
    .expect("read basket-v1.json");
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&raw).unwrap();
    assert_eq!(
        v["domain_hex"].as_str().unwrap(),
        to_hex(crate::payload::DOMAIN)
    );
    let pk: [u8; 32] = from_hex32(v["test_key"]["pubkey_hex"].as_str().unwrap()).unwrap();
    let cases = v["cases"].as_array().unwrap();
    assert!(cases.len() >= 2);
    for c in cases {
        let bytes = hex_bytes(c["payload_hex"].as_str().unwrap());
        let p = BasketPayloadV1::decode(&bytes).expect("vector decodes");
        assert_eq!(p.encode(), bytes, "round trip {}", c["name"]);
        assert_eq!(p.schema_version, 1);
        assert_eq!(p.total, p.payouts.iter().map(|x| x.amount).sum::<u128>());
        let h = basket_hash(&bytes);
        assert_eq!(
            to_hex(&h),
            c["hash_hex"].as_str().unwrap(),
            "hash {}",
            c["name"]
        );
        let sig: [u8; 64] = hex_bytes(c["signature_hex"].as_str().unwrap())
            .try_into()
            .unwrap();
        assert!(
            near_sdk::env::ed25519_verify(&sig, h, &pk),
            "signature {}",
            c["name"]
        );
        // One flipped byte breaks the signature (FR-A04).
        let mut bad = bytes.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert!(!near_sdk::env::ed25519_verify(&sig, basket_hash(&bad), &pk));
        // Trailing bytes are rejected (FR-A03).
        let mut long = bytes.clone();
        long.push(0);
        assert!(BasketPayloadV1::decode(&long).is_none());
    }
}

fn hex_bytes(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

// ---------------------------------------------------------------- init, deposits

#[test]
fn init_views_match_config() {
    let w = World::new();
    let p = w.v.get_policy();
    assert_eq!(p.network_id, "testnet");
    assert_eq!(p.tokens, vec![acc(TOKEN)]);
    assert_eq!(p.vendors.len(), 5);
    assert_eq!(p.max_basket_total.0, 500 * CPUSD);
    assert_eq!(p.daily_cap.0, 1_000 * CPUSD);
    assert_eq!(p.max_vendors, 4);
    assert_eq!(p.rules_hash, to_hex(&RULES));
    assert_eq!(p.guard_key_version, 1);
    assert_eq!(p.policy_version, 1);
    assert!(!p.paused && !p.deficit);
    let s = w.v.get_owner_state(acc(OWNER));
    assert_eq!(s.agents, vec![acc(AGENT)]);
    assert_eq!(s.max_basket.0, 500 * CPUSD);
}

#[test]
fn init_rejects_out_of_bounds() {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(VAULT))
        .build());
    for f in [
        (|c: &mut InitConfig| c.max_vendors = 7) as fn(&mut InitConfig),
        |c| c.max_vendors = 0,
        |c| c.max_ttl_ms = U64(3_600_001),
        |c| c.max_basket_total = U128(c.daily_cap.0 + 1),
        |c| c.guard_key_version = 0,
    ] {
        let mut c = config();
        f(&mut c);
        expect_err("ERR_BOUNDS", || {
            Vault::new(c);
        });
    }
    let mut c = config();
    c.rules_hash = "zz".into();
    expect_err("ERR_DECODE", || {
        Vault::new(c);
    });
}

#[test]
fn deposits_credit_once_and_unknown_tokens_are_refunded() {
    let mut w = World::new();
    assert_eq!(
        w.v.get_balance(acc(OWNER), acc(TOKEN)).available.0,
        500 * CPUSD
    );
    w.inv1();
    // A fake token gets its full amount back and credits nobody.
    w.as_("fake-usd.testnet", 0);
    let r = w.v.ft_on_transfer(acc(OWNER), U128(5), String::new());
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(U128(5))));
    assert_eq!(w.v.get_liabilities(acc("fake-usd.testnet")).0, 0);
    // msg naming someone else still credits the sender (FR-V04).
    w.as_(TOKEN, 0);
    let _ =
        w.v.ft_on_transfer(acc(OWNER), U128(CPUSD), "vendor-02.cpdemo.testnet".into());
    assert_eq!(
        w.v.get_balance(acc(OWNER), acc(TOKEN)).available.0,
        501 * CPUSD
    );
    assert_eq!(w.v.get_balance(vendor(2), acc(TOKEN)).available.0, 0);
    // Zero amount is refunded.
    let r = w.v.ft_on_transfer(acc(OWNER), U128(0), String::new());
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(U128(0))));
    w.inv1();
}

#[test]
fn withdraw_moves_to_withdrawing_and_callbacks_settle_or_restore() {
    let mut w = World::new();
    w.as_(OWNER, 1);
    expect_err("ERR_INSUFFICIENT_AVAILABLE", || {
        let _ = w.v.withdraw(acc(TOKEN), U128(501 * CPUSD));
    });
    w.as_(OWNER, 1);
    let _ = w.v.withdraw(acc(TOKEN), U128(100 * CPUSD));
    let b = w.v.get_balance(acc(OWNER), acc(TOKEN));
    assert_eq!((b.available.0, b.withdrawing.0), (400 * CPUSD, 100 * CPUSD));
    w.inv1();
    // Failure restores available.
    w.callback(PromiseResult::Failed);
    assert!(!w.v.on_withdraw(acc(OWNER), acc(TOKEN), U128(100 * CPUSD)));
    let b = w.v.get_balance(acc(OWNER), acc(TOKEN));
    assert_eq!((b.available.0, b.withdrawing.0), (500 * CPUSD, 0));
    assert_eq!(w.v.get_liabilities(acc(TOKEN)).0, 500 * CPUSD);
    // Success burns withdrawing and liabilities.
    w.as_(OWNER, 1);
    let _ = w.v.withdraw(acc(TOKEN), U128(100 * CPUSD));
    w.callback(PromiseResult::Successful(vec![]));
    assert!(w.v.on_withdraw(acc(OWNER), acc(TOKEN), U128(100 * CPUSD)));
    assert_eq!(w.v.get_liabilities(acc(TOKEN)).0, 400 * CPUSD);
    w.inv1();
    // Needs exactly 1 yocto.
    w.as_(OWNER, 0);
    expect_err("exactly 1 yoctoNEAR", || {
        let _ = w.v.withdraw(acc(TOKEN), U128(1));
    });
}

// ---------------------------------------------------------------- agents, approvals

#[test]
fn set_agent_needs_a_deposit_first_and_caps_at_three() {
    let mut w = World::new();
    w.as_("stranger.testnet", 1);
    expect_err("ERR_UNKNOWN_OWNER", || w.v.set_agent(acc(AGENT), true));
    w.as_(OWNER, 1);
    w.v.set_agent(acc("a2.testnet"), true);
    w.v.set_agent(acc("a3.testnet"), true);
    expect_err("ERR_BOUNDS", || w.v.set_agent(acc("a4.testnet"), true));
    w.as_(OWNER, 1);
    w.v.set_agent(acc("a2.testnet"), false);
    assert_eq!(w.v.get_owner_state(acc(OWNER)).agents.len(), 2);
}

#[test]
fn approvals_need_one_yocto_valid_expiry_and_only_the_owner_revokes() {
    let mut w = World::new();
    let h = to_hex(&[1u8; 32]);
    w.as_(OWNER, 0);
    expect_err("exactly 1 yoctoNEAR", || {
        w.v.approve_basket(h.clone(), U64(w.now_ms + 1000))
    });
    w.as_(OWNER, 1);
    expect_err("ERR_EXPIRED", || {
        w.v.approve_basket(h.clone(), U64(w.now_ms - 1))
    });
    w.as_(OWNER, 1);
    expect_err("ERR_TTL", || {
        w.v.approve_basket(h.clone(), U64(w.now_ms + 31 * 60 * 1000))
    });
    w.as_(OWNER, 1);
    expect_err("ERR_DECODE", || {
        w.v.approve_basket("ABC".into(), U64(w.now_ms + 1000))
    });
    w.as_(OWNER, 1);
    w.v.approve_basket(h.clone(), U64(w.now_ms + 1000));
    assert_eq!(w.v.get_approval(h.clone()).unwrap().owner, acc(OWNER));
    // Another owner cannot take over or revoke it.
    w.as_(TOKEN, 0);
    let _ =
        w.v.ft_on_transfer(acc("other.testnet"), U128(1), String::new());
    w.as_("other.testnet", 1);
    expect_err("ERR_BAD_STATE", || {
        w.v.approve_basket(h.clone(), U64(w.now_ms + 1000))
    });
    w.as_("other.testnet", 1);
    expect_err("ERR_NO_APPROVAL", || w.v.revoke_approval(h.clone()));
    w.as_(OWNER, 1);
    w.v.revoke_approval(h.clone());
    assert!(w.v.get_approval(h).is_none());
}

// ---------------------------------------------------------------- execute: happy path

#[test]
fn execute_reserves_consumes_the_approval_and_settles_partially() {
    let mut w = World::new();
    let p = payload(w.now_ms);
    let h = w.approve(&p);
    assert_eq!(w.execute(&p), h);
    let b = w.v.get_balance(acc(OWNER), acc(TOKEN));
    assert_eq!((b.available.0, b.reserved.0), (467 * CPUSD, 33 * CPUSD));
    assert!(
        w.v.get_approval(h.clone()).is_none(),
        "approval consumed (INV-3)"
    );
    assert_eq!(w.v.get_owner_state(acc(OWNER)).spent_today.0, 33 * CPUSD);
    w.inv1();
    let basket = w.v.get_basket(h.clone()).unwrap();
    assert_eq!(basket.status, BasketStatus::Executing);
    assert_eq!(basket.payouts.len(), 2);

    // Vendor 02 is paid; vendor 06 is unregistered on the token (AT-10).
    w.callback(PromiseResult::Successful(vec![]));
    assert_eq!(w.v.on_payout(h.clone(), 0), PayoutStatus::Completed);
    w.callback(PromiseResult::Failed);
    assert_eq!(w.v.on_payout(h.clone(), 1), PayoutStatus::Failed);

    let b = w.v.get_balance(acc(OWNER), acc(TOKEN));
    assert_eq!((b.available.0, b.reserved.0), (477 * CPUSD, 0));
    assert_eq!(w.v.get_liabilities(acc(TOKEN)).0, 477 * CPUSD);
    assert_eq!(
        w.v.get_owner_state(acc(OWNER)).spent_today.0,
        23 * CPUSD,
        "failed payout returns the allowance"
    );
    assert_eq!(
        w.v.get_basket(h.clone()).unwrap().status,
        BasketStatus::PartiallyPaid
    );
    w.inv1();

    // A second callback for a final payout is rejected (AT-12), so no double credit.
    w.callback(PromiseResult::Failed);
    expect_err("ERR_BAD_STATE", || {
        w.v.on_payout(h.clone(), 1);
    });
    // Replay (AT-06).
    expect_err("ERR_ALREADY_USED", || {
        w.execute(&p);
    });
    // Can't re-approve a used hash either.
    w.as_(OWNER, 1);
    expect_err("ERR_ALREADY_USED", || {
        w.v.approve_basket(h.clone(), U64(w.now_ms + 1000))
    });
    let list = w.v.get_baskets(acc(OWNER), None, None);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].hash, h);
}

#[test]
fn two_baskets_racing_for_the_same_funds() {
    let mut w = World::new();
    let mut a = payload(w.now_ms);
    a.payouts = vec![PayoutV1 {
        vendor_id: vendor(1).to_string(),
        amount: 300 * CPUSD,
        line_count: 1,
    }];
    a.total = 300 * CPUSD;
    let mut b = a.clone();
    b.nonce = 2;
    w.approve(&a);
    w.approve(&b);
    w.execute(&a);
    expect_err("ERR_INSUFFICIENT_AVAILABLE", || {
        w.execute(&b);
    });
    w.inv1();
}

#[test]
fn daily_cap_rolls_over_at_utc_midnight() {
    let mut w = World::new();
    w.as_(TOKEN, 0);
    let _ =
        w.v.ft_on_transfer(acc(OWNER), U128(2_000 * CPUSD), String::new());
    let mut n = 0u64;
    let mut basket = |w: &mut World, amt: u128| {
        n += 1;
        let mut p = payload(w.now_ms);
        p.nonce = n;
        p.payouts = vec![PayoutV1 {
            vendor_id: vendor(1).to_string(),
            amount: amt,
            line_count: 1,
        }];
        p.total = amt;
        p
    };
    for _ in 0..2 {
        let p = basket(&mut w, 500 * CPUSD);
        w.approve(&p);
        w.execute(&p);
    }
    let p = basket(&mut w, CPUSD);
    w.approve(&p);
    expect_err("ERR_OVER_DAILY_CAP", || {
        w.execute(&p);
    });
    w.now_ms += crate::DAY_MS;
    w.as_(OWNER, 0);
    assert_eq!(w.v.get_owner_state(acc(OWNER)).spent_today.0, 0);
    let p = basket(&mut w, CPUSD);
    w.approve(&p);
    w.execute(&p);
    assert_eq!(w.v.get_owner_state(acc(OWNER)).spent_today.0, CPUSD);
}

// ---------------------------------------------------------------- execute: every error path

#[test]
fn every_execute_error_code_and_no_state_change() {
    type Mutate = fn(&mut World, &mut BasketPayloadV1);
    // (expected code, mutation applied before signing, approve the mutated payload?)
    let rows: Vec<(&str, Mutate, bool)> = vec![
        ("ERR_NETWORK", |_, p| p.network_id = "mainnet".into(), true),
        (
            "ERR_VAULT_ID",
            |_, p| p.vault_id = "other-vault.testnet".into(),
            true,
        ),
        ("ERR_POLICY_VERSION", |_, p| p.policy_version = 2, true),
        ("ERR_RULES_HASH", |_, p| p.rules_hash = [8u8; 32], true),
        ("ERR_KEY_VERSION", |_, p| p.guard_key_version = 2, true),
        ("ERR_DECODE", |_, p| p.schema_version = 2, true),
        (
            "ERR_AGENT_MISMATCH",
            |_, p| p.agent_id = "thief.testnet".into(),
            true,
        ),
        ("ERR_NO_APPROVAL", |_, _| {}, false),
        (
            "ERR_EXPIRED",
            |w, p| {
                p.created_at_ms = w.now_ms - 20 * 60 * 1000;
                p.expires_at_ms = w.now_ms - 1
            },
            true,
        ),
        (
            "ERR_TTL",
            |w, p| p.expires_at_ms = w.now_ms + 31 * 60 * 1000,
            true,
        ),
        (
            "ERR_TOKEN",
            |_, p| p.token_id = "fake-usd.testnet".into(),
            true,
        ),
        (
            "ERR_PAYOUT_COUNT",
            |_, p| {
                p.payouts.clear();
                p.total = 0
            },
            true,
        ),
        (
            "ERR_PAYOUT_COUNT",
            |_, p| {
                p.payouts = (1..=5)
                    .map(|i| PayoutV1 {
                        vendor_id: format!("vendor-0{i}.cpdemo.testnet"),
                        amount: 1,
                        line_count: 1,
                    })
                    .collect();
                p.total = 5;
            },
            true,
        ),
        (
            "ERR_DUP_VENDOR",
            |_, p| p.payouts[1].vendor_id = p.payouts[0].vendor_id.clone(),
            true,
        ),
        (
            "ERR_VENDOR",
            |_, p| p.payouts[1].vendor_id = "vendor-05.cpdemo.testnet".into(),
            true,
        ),
        (
            "ERR_ZERO_AMOUNT",
            |_, p| {
                p.payouts[1].amount = 0;
                p.total = p.payouts[0].amount
            },
            true,
        ),
        ("ERR_TOTAL_MISMATCH", |_, p| p.total += 1, true),
        (
            "ERR_TOTAL_MISMATCH",
            |_, p| {
                p.payouts[0].amount = u128::MAX;
                p.payouts[1].amount = 2
            },
            true,
        ),
        (
            "ERR_OVER_BASKET_CAP",
            |_, p| {
                p.payouts[0].amount = 491 * CPUSD;
                p.total = 501 * CPUSD
            },
            true,
        ),
        (
            "ERR_INSUFFICIENT_AVAILABLE",
            |w, p| {
                w.as_(DAO, 1);
                w.v.set_limits(
                    U128(1_000 * CPUSD),
                    U128(1_000 * CPUSD),
                    4,
                    U64(30 * 60 * 1000),
                );
                p.policy_version = 2;
                p.payouts[0].amount = 591 * CPUSD;
                p.total = 601 * CPUSD;
            },
            true,
        ),
        (
            "ERR_AGENT_NOT_AUTHORISED",
            |w, _| {
                w.as_(OWNER, 1);
                w.v.set_agent(acc(AGENT), false)
            },
            true,
        ),
        (
            "ERR_PAUSED",
            |w, _| {
                w.as_(GUARDIAN, 1);
                w.v.emergency_pause("test".into())
            },
            true,
        ),
    ];

    for (code, mutate, approve) in rows {
        let mut w = World::new();
        let mut p = payload(w.now_ms);
        mutate(&mut w, &mut p);
        if approve && code != "ERR_PAUSED" {
            w.approve(&p);
        }
        let before = (
            w.v.get_balance(acc(OWNER), acc(TOKEN)).available.0,
            w.v.get_owner_state(acc(OWNER)).spent_today.0,
        );
        expect_err(code, || {
            w.execute(&p);
        });
        let after = (
            w.v.get_balance(acc(OWNER), acc(TOKEN)).available.0,
            w.v.get_owner_state(acc(OWNER)).spent_today.0,
        );
        assert_eq!(before, after, "{code}: state changed");
        assert_eq!(
            w.v.get_status().basket_count.0,
            0,
            "{code}: basket recorded"
        );
        w.inv1();
    }
}

#[test]
fn tampered_payload_or_signature_fails_bad_signature() {
    let mut w = World::new();
    let p = payload(w.now_ms);
    w.approve(&p);
    let (bytes, sig) = sign(&p);
    let mut b2 = bytes.0.clone();
    let i = b2.len() - 30;
    b2[i] ^= 1; // flips a byte of the evidence hash
    w.as_(AGENT, 0);
    expect_err("ERR_BAD_SIGNATURE", || {
        w.v.execute_basket(Base64VecU8(b2), sig.clone());
    });
    let mut s2 = sig.0.clone();
    s2[0] ^= 1;
    w.as_(AGENT, 0);
    expect_err("ERR_BAD_SIGNATURE", || {
        w.v.execute_basket(bytes.clone(), Base64VecU8(s2));
    });
    w.as_(AGENT, 0);
    expect_err("ERR_BAD_SIGNATURE", || {
        w.v.execute_basket(bytes.clone(), Base64VecU8(vec![0u8; 10]));
    });
    let mut long = bytes.0.clone();
    long.push(0);
    w.as_(AGENT, 0);
    expect_err("ERR_DECODE", || {
        w.v.execute_basket(Base64VecU8(long), sig.clone());
    });
    w.as_gas(AGENT, 50);
    expect_err("ERR_GAS", || {
        w.v.execute_basket(bytes.clone(), sig.clone());
    });
}

#[test]
fn disabled_guard_key_fails_until_rotated() {
    let mut w = World::new();
    let p = payload(w.now_ms);
    w.approve(&p);
    w.as_(GUARDIAN, 1);
    w.v.disable_guard_key();
    expect_err("ERR_KEY_VERSION", || {
        w.execute(&p);
    });
}

// ---------------------------------------------------------------- admin and guardian

#[test]
fn admin_methods_reject_non_dao_callers() {
    type AdminCall = (&'static str, fn(&mut Vault));
    let calls: Vec<AdminCall> = vec![
        ("set_vendor", |v| v.set_vendor(vendor(5), true)),
        ("set_token", |v| v.set_token(acc("x.testnet"), true)),
        ("set_limits", |v| v.set_limits(U128(1), U128(1), 1, U64(1))),
        ("set_rules_hash", |v| v.set_rules_hash(to_hex(&[1u8; 32]))),
        ("set_guard_key", |v| {
            v.set_guard_key(near_sdk::bs58::encode([1u8; 32]).into_string(), 2)
        }),
        ("set_guardian", |v| v.set_guardian(acc("x.testnet"))),
        ("transfer_admin", |v| v.transfer_admin(acc("x.testnet"))),
        ("unpause", |v| v.unpause()),
        ("clear_deficit", |v| v.clear_deficit()),
        ("resolve_stuck_payout", |v| {
            v.resolve_stuck_payout(to_hex(&[1u8; 32]), 0, true);
        }),
    ];
    for who in [OWNER, GUARDIAN, AGENT] {
        for (name, f) in &calls {
            let mut w = World::new();
            w.as_(who, 1);
            let r = catch_unwind(AssertUnwindSafe(|| f(&mut w.v)));
            let msg = r
                .err()
                .and_then(|e| e.downcast_ref::<String>().cloned())
                .unwrap_or_default();
            assert!(msg.contains("ERR_NOT_DAO"), "{name} by {who}: {msg}");
        }
    }
}

#[test]
fn dao_changes_bump_policy_version_and_invalidate_old_payloads() {
    let mut w = World::new();
    let p = payload(w.now_ms);
    w.approve(&p);
    w.as_(DAO, 1);
    w.v.set_limits(U128(200 * CPUSD), U128(300 * CPUSD), 4, U64(30 * 60 * 1000));
    assert_eq!(w.v.get_policy().policy_version, 2);
    assert_eq!(w.v.get_policy().daily_cap.0, 300 * CPUSD);
    expect_err("ERR_POLICY_VERSION", || {
        w.execute(&p);
    }); // AT-07
    w.as_(DAO, 1);
    expect_err("ERR_BOUNDS", || w.v.set_limits(U128(2), U128(1), 4, U64(1)));
    w.as_(DAO, 1);
    expect_err("ERR_BOUNDS", || w.v.set_limits(U128(1), U128(1), 7, U64(1)));
    w.as_(DAO, 1);
    expect_err("ERR_BOUNDS", || {
        w.v.set_guard_key(near_sdk::bs58::encode([1u8; 32]).into_string(), 1)
    });
    w.as_(DAO, 1);
    w.v.set_vendor(vendor(5), true);
    w.v.set_rules_hash(to_hex(&[3u8; 32]));
    w.v.set_guard_key(
        format!(
            "ed25519:{}",
            near_sdk::bs58::encode([1u8; 32]).into_string()
        ),
        2,
    );
    let pol = w.v.get_policy();
    assert_eq!(pol.policy_version, 5);
    assert!(pol.vendors.contains(&vendor(5)));
    assert_eq!(pol.guard_key_version, 2);
    assert_eq!(
        pol.guard_pubkey,
        near_sdk::bs58::encode([1u8; 32]).into_string()
    );
    // Hand-over: the old admin loses its powers (FR-G04).
    w.v.transfer_admin(acc("checkpoint-council.sputnik-v2.testnet"));
    w.as_(DAO, 1);
    expect_err("ERR_NOT_DAO", || w.v.set_vendor(vendor(1), false));
}

#[test]
fn guardian_can_pause_but_not_unpause_and_withdrawals_continue() {
    let mut w = World::new();
    w.as_(OWNER, 1);
    expect_err("ERR_NOT_GUARDIAN", || w.v.emergency_pause("x".into()));
    w.as_(GUARDIAN, 1);
    w.v.emergency_pause("drill".into());
    assert!(w.v.get_policy().paused);
    w.as_(GUARDIAN, 1);
    expect_err("ERR_NOT_DAO", || w.v.unpause());
    w.as_(GUARDIAN, 1);
    expect_err("ERR_NOT_DAO", || {
        w.v.set_limits(U128(1), U128(1), 1, U64(1))
    });
    w.as_(OWNER, 1);
    expect_err("ERR_PAUSED", || {
        w.v.approve_basket(to_hex(&[1u8; 32]), U64(w.now_ms + 1000))
    });
    w.as_(OWNER, 1);
    let _ = w.v.withdraw(acc(TOKEN), U128(CPUSD)); // still allowed (AT-16)
    w.as_(DAO, 1);
    w.v.unpause();
    assert!(!w.v.get_policy().paused);
}

#[test]
fn stuck_payout_resolves_only_after_ten_minutes() {
    let mut w = World::new();
    let p = payload(w.now_ms);
    let h = w.approve(&p);
    w.execute(&p);
    w.as_(DAO, 1);
    expect_err("ERR_BAD_STATE", || {
        w.v.resolve_stuck_payout(h.clone(), 0, true);
    });
    w.now_ms += crate::STUCK_PAYOUT_MS;
    w.as_(DAO, 1);
    assert_eq!(
        w.v.resolve_stuck_payout(h.clone(), 0, true),
        PayoutStatus::Completed
    );
    w.as_(DAO, 1);
    assert_eq!(
        w.v.resolve_stuck_payout(h.clone(), 1, false),
        PayoutStatus::Failed
    );
    // A late callback can't settle it again.
    w.callback(PromiseResult::Successful(vec![]));
    expect_err("ERR_BAD_STATE", || {
        w.v.on_payout(h.clone(), 0);
    });
    w.inv1();
}

// ---------------------------------------------------------------- reconciliation (AT-17, AT-18)

#[test]
fn solvency_flags_a_deficit_and_blocks_money_movement() {
    let mut w = World::new();
    let epoch = U64(w.v.epoch(&acc(TOKEN)));
    // Surplus: the token reports more than the Vault owes (a plain ft_transfer donation).
    w.callback(PromiseResult::Successful(b"\"600000000\"".to_vec()));
    assert!(w.v.on_solvency(acc(TOKEN), epoch, Ok(U128(600 * CPUSD))));
    // Deficit: the token reports less.
    w.callback(PromiseResult::Successful(b"\"400000000\"".to_vec()));
    assert!(!w.v.on_solvency(acc(TOKEN), epoch, Ok(U128(400 * CPUSD))));
    let pol = w.v.get_policy();
    assert!(pol.deficit && pol.paused);
    w.as_(OWNER, 1);
    expect_err("ERR_DEFICIT", || {
        let _ = w.v.withdraw(acc(TOKEN), U128(1));
    });
    w.as_(TOKEN, 0);
    let r = w.v.ft_on_transfer(acc(OWNER), U128(5), String::new());
    assert!(
        matches!(r, near_sdk::PromiseOrValue::Value(U128(5))),
        "deposits refunded during a deficit"
    );
    w.as_(DAO, 1);
    expect_err("ERR_DEFICIT", || w.v.unpause());
    w.as_(DAO, 1);
    w.v.clear_deficit();
    w.v.unpause();
    // A stale reading (balances moved since the check) is skipped.
    w.as_(TOKEN, 0);
    let _ = w.v.ft_on_transfer(acc(OWNER), U128(5), String::new());
    w.callback(PromiseResult::Successful(vec![]));
    assert!(w.v.on_solvency(acc(TOKEN), epoch, Ok(U128(0))));
    assert!(!w.v.get_policy().deficit);
}
