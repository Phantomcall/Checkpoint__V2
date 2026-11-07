//! End-to-end Vault behaviour against a real cpUSD in a local sandbox:
//! AT-01, AT-05, AT-06, AT-08, AT-10, AT-11, AT-12, AT-16, AT-17, AT-18,
//! withdraw failure, and gas measurement for docs/gas.md.

mod common;

use common::*;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::Account;
use serde_json::json;

#[tokio::test]
async fn at01_two_vendor_basket_pays_both_and_holds_inv1() -> anyhow::Result<()> {
    let e = Env::new().await?;
    e.assert_inv1().await?;
    let p = e.payload(&[(2, 23 * CPUSD), (3, 10 * CPUSD)], 1).await?;
    let s = sign(&p);
    e.approve(&s).await?;
    let r = e.execute(&s).await?;
    ok(&r);
    assert!(r.logs().iter().any(|l| l.contains("\"basket_executed\"")));
    let b = e.basket(&s.hash_hex).await?;
    assert_eq!(b["status"], "Completed", "{b}");
    assert_eq!(e.ft_balance(e.vendors[2].id()).await?, 23 * CPUSD);
    assert_eq!(e.ft_balance(e.vendors[3].id()).await?, 10 * CPUSD);
    assert_eq!(e.balance().await?, (467 * CPUSD, 0, 0));
    e.assert_inv1().await?;

    // AT-06: replay.
    let r = e.execute(&s).await?;
    assert!(err_of(&r).contains("ERR_ALREADY_USED"));
    Ok(())
}

#[tokio::test]
async fn at10_unregistered_vendor_ends_partially_paid_and_restores_once() -> anyhow::Result<()> {
    let e = Env::new().await?;
    let p = e.payload(&[(2, 23 * CPUSD), (6, 10 * CPUSD)], 1).await?;
    let s = sign(&p);
    e.approve(&s).await?;
    // execute_basket succeeds; only the vendor-06 transfer receipt inside it fails.
    let r = e.execute(&s).await?;
    assert!(r.logs().iter().any(|l| l.contains("\"payout_failed\"")));
    let b = e.basket(&s.hash_hex).await?;
    assert_eq!(b["status"], "PartiallyPaid", "{b}");
    assert_eq!(b["payouts"][0]["status"], "Completed");
    assert_eq!(b["payouts"][1]["status"], "Failed");
    assert_eq!(e.ft_balance(e.vendors[2].id()).await?, 23 * CPUSD);
    assert_eq!(
        e.balance().await?,
        (477 * CPUSD, 0, 0),
        "restored exactly once"
    );
    let os = e
        .view("get_owner_state", json!({ "owner_id": e.owner.id() }))
        .await?;
    assert_eq!(os["spent_today"], (23 * CPUSD).to_string());
    e.assert_inv1().await?;
    Ok(())
}

#[tokio::test]
async fn at05_edit_after_approval_and_at11_race() -> anyhow::Result<()> {
    let e = Env::new().await?;
    let p = e.payload(&[(2, 300 * CPUSD)], 1).await?;
    let s = sign(&p);
    e.approve(&s).await?;
    // AT-05: swap the vendor after approval and re-sign (as a buggy Guard would):
    // the new hash has no approval.
    let mut edited = p.clone();
    edited.payouts[0].vendor_id = e.vendors[3].id().to_string();
    let r = e.execute(&sign(&edited)).await?;
    assert!(err_of(&r).contains("ERR_NO_APPROVAL"));
    // AT-11: two approved baskets for 300 each; only 500 available.
    let p2 = e.payload(&[(3, 300 * CPUSD)], 2).await?;
    let s2 = sign(&p2);
    e.approve(&s2).await?;
    ok(&e.execute(&s).await?);
    let r = e.execute(&s2).await?;
    assert!(err_of(&r).contains("ERR_INSUFFICIENT_AVAILABLE"));
    e.assert_inv1().await?;
    Ok(())
}

#[tokio::test]
async fn at12_outsiders_cannot_call_callbacks() -> anyhow::Result<()> {
    let e = Env::new().await?;
    let p = e.payload(&[(2, CPUSD)], 1).await?;
    let s = sign(&p);
    e.approve(&s).await?;
    ok(&e.execute(&s).await?);
    for (m, args) in [
        ("on_payout", json!({ "hash_hex": s.hash_hex, "index": 0 })),
        (
            "on_withdraw",
            json!({ "owner": e.owner.id(), "token_id": e.token.id(), "amount": "1" }),
        ),
        (
            "on_solvency",
            json!({ "token_id": e.token.id(), "epoch": "0" }),
        ),
    ] {
        let r = e
            .owner
            .call(e.vault.id(), m)
            .args_json(args)
            .transact()
            .await?;
        assert!(err_of(&r).contains("is private"), "{m}");
    }
    Ok(())
}

#[tokio::test]
async fn at08_stolen_function_call_key_can_only_call_execute_basket() -> anyhow::Result<()> {
    let e = Env::new().await?;
    // The agent's FC key: receiver = Vault, method = execute_basket, 1 NEAR allowance.
    let sk = SecretKey::from_random(KeyType::ED25519);
    ok(&e
        .agent
        .batch(e.agent.id())
        .add_key(
            sk.public_key(),
            AccessKey::function_call_access(
                e.vault.id(),
                &["execute_basket"],
                Some(NearToken::from_near(1)),
            ),
        )
        .transact()
        .await?);
    let thief = Account::from_secret_key(e.agent.id().clone(), sk, &e.worker);

    // A self-paying payload: no Guard signature for it, no approval, unlisted vendor.
    let mut p = e.payload(&[(2, 100 * CPUSD)], 7).await?;
    p.payouts[0].vendor_id = thief.id().to_string();
    let mut s = sign(&p);
    s.signature_b64 = b64(&[0u8; 64]);
    let r = thief
        .call(e.vault.id(), "execute_basket")
        .args_json(json!({ "payload_b64": s.payload_b64, "signature_b64": s.signature_b64 }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    assert!(err_of(&r).contains("ERR_BAD_SIGNATURE"));
    // Any other method, or any deposit, is refused by the protocol itself.
    let r = thief
        .call(e.vault.id(), "withdraw")
        .args_json(json!({ "token_id": e.token.id(), "amount": "1" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await;
    assert!(r.is_err() || r.unwrap().is_failure());
    let r = thief
        .call(e.token.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": thief.id(), "amount": "1" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await;
    assert!(r.is_err() || r.unwrap().is_failure());
    assert_eq!(e.balance().await?, (500 * CPUSD, 0, 0));
    Ok(())
}

#[tokio::test]
async fn withdraw_failure_restores_available_and_pause_does_not_block_withdraw(
) -> anyhow::Result<()> {
    let e = Env::new().await?;
    ok(&e
        .token
        .call("set_fail_transfers")
        .args_json(json!({ "fail": true }))
        .transact()
        .await?);
    let r = e
        .owner
        .call(e.vault.id(), "withdraw")
        .args_json(json!({ "token_id": e.token.id(), "amount": (100 * CPUSD).to_string() }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(
        r.logs().iter().any(|l| l.contains("\"withdraw_failed\"")),
        "{:?}",
        r.logs()
    );
    assert_eq!(e.balance().await?, (500 * CPUSD, 0, 0));
    e.assert_inv1().await?;

    ok(&e
        .token
        .call("set_fail_transfers")
        .args_json(json!({ "fail": false }))
        .transact()
        .await?);
    // AT-16: the guardian pauses; withdrawals still work, approvals don't.
    ok(&e
        .guardian
        .call(e.vault.id(), "emergency_pause")
        .args_json(json!({ "reason": "drill" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?);
    let before = e.ft_balance(e.owner.id()).await?;
    ok(&e
        .owner
        .call(e.vault.id(), "withdraw")
        .args_json(json!({ "token_id": e.token.id(), "amount": (100 * CPUSD).to_string() }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?);
    assert_eq!(e.ft_balance(e.owner.id()).await?, before + 100 * CPUSD);
    assert_eq!(e.balance().await?, (400 * CPUSD, 0, 0));
    let r = e
        .guardian
        .call(e.vault.id(), "unpause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert!(err_of(&r).contains("ERR_NOT_DAO"));
    e.assert_inv1().await?;
    Ok(())
}

#[tokio::test]
async fn at17_deficit_and_at18_donation_surplus() -> anyhow::Result<()> {
    let e = Env::new().await?;
    // AT-18: a plain ft_transfer (no _call) credits nobody and shows as surplus.
    ok(&e
        .owner
        .call(e.token.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": e.vault.id(), "amount": (5 * CPUSD).to_string() }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?);
    let r = e
        .root
        .call(e.vault.id(), "check_solvency")
        .args_json(json!({ "token_id": e.token.id() }))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    ok(&r);
    let rec = r
        .logs()
        .into_iter()
        .find(|l| l.contains("\"reconciled\""))
        .expect("reconciled event")
        .to_string();
    assert!(
        rec.contains(&format!("\"surplus\":\"{}\"", 5 * CPUSD)),
        "{rec}"
    );
    assert_eq!(e.balance().await?.0, 500 * CPUSD);

    // AT-17: burn tokens out of the Vault (test-only token method) → deficit.
    ok(&e
        .token
        .call("burn_from")
        .args_json(json!({ "account_id": e.vault.id(), "amount": (10 * CPUSD).to_string() }))
        .transact()
        .await?);
    let r = e
        .root
        .call(e.vault.id(), "check_solvency")
        .args_json(json!({ "token_id": e.token.id() }))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        r.logs().iter().any(|l| l.contains("\"deficit_detected\"")),
        "{:?}",
        r.logs()
    );
    let pol = e.view("get_policy", json!({})).await?;
    assert_eq!(
        (pol["deficit"].as_bool(), pol["paused"].as_bool()),
        (Some(true), Some(true))
    );
    let r = e
        .owner
        .call(e.vault.id(), "withdraw")
        .args_json(json!({ "token_id": e.token.id(), "amount": "1" }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(err_of(&r).contains("ERR_DEFICIT"));
    // Only the DAO clears it.
    let r = e
        .guardian
        .call(e.vault.id(), "clear_deficit")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert!(err_of(&r).contains("ERR_NOT_DAO"));
    ok(&e
        .dao
        .call(e.vault.id(), "clear_deficit")
        .deposit(ONE_YOCTO)
        .transact()
        .await?);
    ok(&e
        .dao
        .call(e.vault.id(), "unpause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?);
    Ok(())
}

#[tokio::test]
async fn gas_for_a_four_vendor_basket() -> anyhow::Result<()> {
    let e = Env::new().await?;
    let p = e
        .payload(&[(1, CPUSD), (2, CPUSD), (3, CPUSD), (4, CPUSD)], 1)
        .await?;
    let s = sign(&p);
    e.approve(&s).await?;
    let r = e.execute(&s).await?;
    ok(&r);
    let mut by_kind: Vec<(String, u64)> = Vec::new();
    for o in r.receipt_outcomes() {
        let kind = if o.executor_id == *e.vault.id() {
            "vault"
        } else {
            "token"
        };
        by_kind.push((kind.to_string(), o.gas_burnt.as_gas()));
    }
    let max = |k: &str| {
        by_kind
            .iter()
            .filter(|(x, _)| x == k)
            .map(|(_, g)| *g)
            .max()
            .unwrap_or(0)
    };
    println!(
        "GAS 4-vendor basket: total {} TGas; max token receipt {} TGas; max vault receipt (execute or on_payout) {} TGas",
        r.total_gas_burnt.as_tgas(),
        max("token") as f64 / 1e12,
        max("vault") as f64 / 1e12,
    );
    assert_eq!(e.basket(&s.hash_hex).await?["status"], "Completed");
    e.assert_inv1().await?;
    Ok(())
}
