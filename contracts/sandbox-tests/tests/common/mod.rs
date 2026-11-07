//! Sandbox fixture: cpUSD + Vault deployed, an owner funded and an agent authorised.
#![allow(dead_code)]

use std::path::PathBuf;

use base64::Engine;
use borsh::BorshSerialize;
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const CPUSD: u128 = 1_000_000;
pub const DOMAIN: &[u8] = b"CHECKPOINT_BASKET_V1\x00";
pub const RULES: [u8; 32] = [7u8; 32];
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[derive(BorshSerialize, Clone)]
pub struct PayoutV1 {
    pub vendor_id: String,
    pub amount: u128,
    pub line_count: u16,
}

#[derive(BorshSerialize, Clone)]
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

pub fn wasm(name: &str) -> Vec<u8> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/near");
    let p = root.join(name);
    std::fs::read(&p).unwrap_or_else(|_| {
        panic!(
            "{} is missing. Run `pnpm contracts:build` first.",
            p.display()
        )
    })
}

pub fn guard_key() -> SigningKey {
    SigningKey::from_bytes(&[42u8; 32])
}

pub fn hash(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(DOMAIN);
    h.update(bytes);
    h.finalize().into()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

pub struct Signed {
    pub payload_b64: String,
    pub signature_b64: String,
    pub hash_hex: String,
}

pub fn sign(p: &BasketPayloadV1) -> Signed {
    let bytes = borsh::to_vec(p).unwrap();
    let h = hash(&bytes);
    let sig = guard_key().sign(&h);
    Signed {
        payload_b64: b64(&bytes),
        signature_b64: b64(&sig.to_bytes()),
        hash_hex: hex(&h),
    }
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub token: Contract,
    pub vault: Contract,
    pub owner: Account,
    pub agent: Account,
    pub dao: Account,
    pub guardian: Account,
    /// vendor[1..=6]; vendor 5 is not allowlisted, vendor 6 is not registered on cpUSD.
    pub vendors: Vec<Account>,
}

pub fn ok(r: &ExecutionFinalResult) {
    assert!(r.is_success(), "call failed: {:#?}", r.failures());
}

/// The first ERR_ code in a failed result (or the whole failure text).
pub fn err_of(r: &ExecutionFinalResult) -> String {
    assert!(r.is_failure(), "expected a failure, the call succeeded");
    format!("{:?}", r.failures())
}

pub async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

impl Env {
    pub async fn new() -> anyhow::Result<Self> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let token_acc = sub(&root, "cpusd", 10).await?;
        let vault_acc = sub(&root, "vault", 20).await?;
        let owner = sub(&root, "owner-demo", 10).await?;
        let agent = sub(&root, "agent", 5).await?;
        let dao = sub(&root, "dao", 5).await?;
        let guardian = sub(&root, "guardian", 5).await?;
        let mut vendors = vec![root.clone()]; // index 0 unused
        for i in 1..=6 {
            vendors.push(sub(&root, &format!("vendor-0{i}"), 2).await?);
        }

        let token = token_acc
            .deploy(&wasm("cpusd-sandbox/checkpoint_cpusd.wasm"))
            .await?
            .into_result()?;
        ok(&token
            .call("new")
            .args_json(json!({ "owner_id": token.id() }))
            .transact()
            .await?);

        let vault = vault_acc
            .deploy(&wasm("vault/checkpoint_vault.wasm"))
            .await?
            .into_result()?;
        let vendor_ids: Vec<&AccountId> =
            [1, 2, 3, 4, 6].iter().map(|&i| vendors[i].id()).collect();
        let r = vault
            .call("new")
            .args_json(json!({ "config": {
                "network_id": "sandbox",
                "tokens": [token.id()],
                "vendors": vendor_ids,
                "max_basket_total": (500 * CPUSD).to_string(),
                "daily_cap": (1_000 * CPUSD).to_string(),
                "max_vendors": 4,
                "max_ttl_ms": "1800000",
                "rules_hash": hex(&RULES),
                "guard_pubkey": bs58::encode(guard_key().verifying_key().to_bytes()).into_string(),
                "guard_key_version": 1,
                "guardian": guardian.id(),
                "dao_id": dao.id(),
            }}))
            .transact()
            .await?;
        ok(&r);

        let env = Env {
            worker,
            root,
            token,
            vault,
            owner,
            agent,
            dao,
            guardian,
            vendors,
        };
        // Storage registration: vault, owner, vendors 1–5 (never vendor 6, for AT-10).
        let mut regs: Vec<AccountId> = vec![env.vault.id().clone(), env.owner.id().clone()];
        for i in 1..=5 {
            regs.push(env.vendors[i].id().clone());
        }
        for a in regs {
            ok(&env
                .root
                .call(env.token.id(), "storage_deposit")
                .args_json(json!({ "account_id": a, "registration_only": true }))
                .deposit(NearToken::from_millinear(125))
                .transact()
                .await?);
        }
        ok(&env
            .token
            .call("mint")
            .args_json(
                json!({ "account_id": env.owner.id(), "amount": (1_000 * CPUSD).to_string() }),
            )
            .transact()
            .await?);
        env.deposit(&env.owner, 500 * CPUSD).await?;
        ok(&env
            .owner
            .call(env.vault.id(), "set_agent")
            .args_json(json!({ "agent_id": env.agent.id(), "enabled": true }))
            .deposit(ONE_YOCTO)
            .transact()
            .await?);
        Ok(env)
    }

    pub async fn deposit(&self, from: &Account, amount: u128) -> anyhow::Result<()> {
        ok(&from
            .call(self.token.id(), "ft_transfer_call")
            .args_json(
                json!({ "receiver_id": self.vault.id(), "amount": amount.to_string(), "msg": "" }),
            )
            .deposit(ONE_YOCTO)
            .gas(Gas::from_tgas(100))
            .transact()
            .await?);
        Ok(())
    }

    pub async fn ft_balance(&self, who: &AccountId) -> anyhow::Result<u128> {
        let v: String = self
            .token
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    pub async fn view(&self, method: &str, args: Value) -> anyhow::Result<Value> {
        Ok(self.vault.view(method).args_json(args).await?.json()?)
    }

    pub async fn balance(&self) -> anyhow::Result<(u128, u128, u128)> {
        let b = self
            .view(
                "get_balance",
                json!({ "owner_id": self.owner.id(), "token_id": self.token.id() }),
            )
            .await?;
        let n = |k: &str| b[k].as_str().unwrap().parse::<u128>().unwrap();
        Ok((n("available"), n("reserved"), n("withdrawing")))
    }

    /// INV-1: the Vault holds at least what it owes, and what it owes is the
    /// sum of the (single) owner's balances.
    pub async fn assert_inv1(&self) -> anyhow::Result<()> {
        let liab: u128 = self
            .view("get_liabilities", json!({ "token_id": self.token.id() }))
            .await?
            .as_str()
            .unwrap()
            .parse()?;
        let (a, r, w) = self.balance().await?;
        assert_eq!(liab, a + r + w, "INV-1: liabilities = Σ balances");
        assert!(
            self.ft_balance(self.vault.id()).await? >= liab,
            "INV-1: token balance ≥ liabilities"
        );
        Ok(())
    }

    pub async fn now_ms(&self) -> anyhow::Result<u64> {
        let b = self.worker.view_block().await?;
        Ok(b.timestamp() / 1_000_000)
    }

    pub async fn payload(
        &self,
        payouts: &[(usize, u128)],
        nonce: u64,
    ) -> anyhow::Result<BasketPayloadV1> {
        let now = self.now_ms().await?;
        let mut ps: Vec<PayoutV1> = payouts
            .iter()
            .map(|&(i, amount)| PayoutV1 {
                vendor_id: self.vendors[i].id().to_string(),
                amount,
                line_count: 1,
            })
            .collect();
        ps.sort_by(|a, b| a.vendor_id.cmp(&b.vendor_id));
        let policy = self.view("get_policy", json!({})).await?;
        Ok(BasketPayloadV1 {
            schema_version: 1,
            network_id: "sandbox".into(),
            vault_id: self.vault.id().to_string(),
            policy_version: policy["policy_version"].as_u64().unwrap() as u32,
            rules_hash: RULES,
            guard_key_version: 1,
            basket_id: format!("00000000-0000-4000-8000-{nonce:012}"),
            owner_id: self.owner.id().to_string(),
            agent_id: self.agent.id().to_string(),
            token_id: self.token.id().to_string(),
            total: ps.iter().map(|p| p.amount).sum(),
            payouts: ps,
            evidence_hash: [9u8; 32],
            nonce,
            created_at_ms: now,
            expires_at_ms: now + 15 * 60 * 1000,
        })
    }

    pub async fn approve(&self, s: &Signed) -> anyhow::Result<()> {
        let now = self.now_ms().await?;
        ok(&self
            .owner
            .call(self.vault.id(), "approve_basket")
            .args_json(json!({ "hash_hex": s.hash_hex, "expires_at_ms": (now + 20 * 60 * 1000).to_string() }))
            .deposit(ONE_YOCTO)
            .transact()
            .await?);
        Ok(())
    }

    pub async fn execute(&self, s: &Signed) -> anyhow::Result<ExecutionFinalResult> {
        Ok(self
            .agent
            .call(self.vault.id(), "execute_basket")
            .args_json(json!({ "payload_b64": s.payload_b64, "signature_b64": s.signature_b64 }))
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    pub async fn basket(&self, hash_hex: &str) -> anyhow::Result<Value> {
        self.view("get_basket", json!({ "hash_hex": hash_hex }))
            .await
    }
}
