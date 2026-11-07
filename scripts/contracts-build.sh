#!/usr/bin/env bash
# Build the contracts into target/near/ (task I-0.1).
#   target/near/vault/checkpoint_vault.wasm          Vault
#   target/near/cpusd/checkpoint_cpusd.wasm          cpUSD for testnet (no fault switches)
#   target/near/cpusd-sandbox/checkpoint_cpusd.wasm  cpUSD with the sandbox fault switches (tests only)
#
# With cargo-near 0.23 installed it uses `cargo near build` (wasm-opt + ABI;
# what testnet runs). Without it, or with CONTRACTS_BUILD=cargo, it falls back
# to plain cargo with the `near` cfg, which needs nothing but Rust and the wasm
# target (CI, and the clean-machine path for pnpm demo:sandbox).
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${CONTRACTS_BUILD:-auto}"
if [ "$mode" = auto ]; then command -v cargo-near >/dev/null && mode=cargo-near || mode=cargo; fi

near_build() { # manifest out_dir [extra args]
  cargo near build non-reproducible-wasm --locked --manifest-path "$1" --out-dir "$2" "${@:3}"
}
cargo_build() { # package crate_file out_dir [extra args]
  local tdir="target/wasm-plain"
  RUSTFLAGS="--cfg near -C link-arg=-s" cargo build -p "$1" --target wasm32-unknown-unknown --release --locked \
    --target-dir "$tdir/$3" "${@:4}"
  mkdir -p "target/near/$3"
  cp "$tdir/$3/wasm32-unknown-unknown/release/$2.wasm" "target/near/$3/$2.wasm"
}

echo "contracts:build using $mode"
if [ "$mode" = cargo-near ]; then
  near_build contracts/vault/Cargo.toml target/near/vault
  near_build contracts/cpusd/Cargo.toml target/near/cpusd
  near_build contracts/cpusd/Cargo.toml target/near/cpusd-sandbox --features sandbox
else
  cargo_build checkpoint-vault checkpoint_vault vault
  cargo_build checkpoint-cpusd checkpoint_cpusd cpusd
  cargo_build checkpoint-cpusd checkpoint_cpusd cpusd-sandbox --features sandbox
fi
ls -l target/near/*/*.wasm
