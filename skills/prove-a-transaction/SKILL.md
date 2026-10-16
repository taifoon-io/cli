---
name: prove-a-transaction
description: "Get a proof that one transaction is inside the Taifoon superroot and check it yourself: GET /v1/proof/tx/{chain}/{tx} returns the block, the superroot that commits to it, the portable V5 blob and the checks made; compare the block hash against your own RPC and the root against GET /v1/root. Use when an agent must show a counterparty that a payment, a delivery or any transaction happened on Base, Arc, Ethereum or another included chain, or must verify such a claim. Do NOT use to grade whether work met its spec (use grade-with-jev) or to move funds between chains (use bridge-with-proof)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1; any public RPC of the chain for the independent check"
metadata:
  title: "Prove a transaction"
  category: "Prove"
  summary: "One call returns the proof; two more check it against the chain and the root."
  use_when: "You must show, or check, that a transaction happened and is under the superroot."
  not_when: "You need a quality verdict on work, or a cross-chain transfer."
  first_call: "GET /v1/proof/tx/{chain}/{tx}"
  success: "proof_state proven with every check true"
  verified: "2026-10-04"
---

# Prove a transaction under the superroot

## What this is

The layer folds the chains it includes into one superroot about every 10 seconds (`GET /v1/root` lists
`chains_included`). `GET /v1/proof/tx/{chain}/{tx}` answers where a transaction landed, the superroot that commits to that
block, whether it is final, a portable V5 proof blob, and `checks` naming what was verified, including that the proof's
block hash equals the one in the transaction's own receipt. Proofs are free inside the free rate (90 a minute per key); past it a proof is 0.2 GRID from the key's balance (`GET /v1/access`).

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`. No key needed.
- A transaction hash and its chain id (8453 Base, 5042 Arc, 1 Ethereum, …).
- For the independent check: any RPC of that chain you trust more than this API.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-prove-a-transaction" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
CHAIN=${CHAIN:-8453}
TX=${TX:-0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a}   # a USDC burn on Base, block 52043043
```

## Pitfalls

1. Reading `ok: true` as proven. Read `proof_state` and every entry of `checks`; `within_verifiable_range: false` means
   the block is newer than the newest provable one (`verifiable_block`): ask again shortly.
2. Comparing `super_root_hash` with a later `GET /v1/root`. The root changes about every 10 seconds; a proof is under the
   root of its own `batch_id`. Compare the block hash, which never changes, and keep the blob.
3. Trusting the same API for both sides of a comparison. Read the receipt's `blockHash` from your own RPC.
4. Using `/gw/rpc` for the receipt. The gateway serves `eth_blockNumber`, `eth_call`, `eth_getLogs` and `eth_chainId`
   only.
5. Expecting a transaction proof on every chain in the root. `GET /v1/protocols/decoders` (`chains`) says which chains
   the layer reads over RPC, where any transaction is provable, and which are header-committed, where a block proof
   exists and a transaction proof through these routes does not.
6. Treating a reverted transaction as a payment. `checks.tx_succeeded` must be true.

## Steps

### 1. The newest provable block of a chain

```sh
tf "$TAIFOON/proof/verifiable/$CHAIN" \
  | jq -e '(.superroot.superrootHash | test("^0x[0-9a-f]{64}$")) and .chainHeaders[0].chainId == ('"$CHAIN"') and (.chainHeaders[0].blockNumber > 0)' >/dev/null
```

### 2. The proof of your transaction

```sh
PROOF=$(tf "$TAIFOON/proof/tx/$CHAIN/$TX")
echo "$PROOF" | jq -e '.ok and .proof_state == "proven" and .is_finalized
  and .checks.receipt_found and .checks.tx_succeeded and .checks.proof_served and .checks.block_hash_matches and .checks.within_verifiable_range
  and (.blob.superroot.superrootHash | test("^0x[0-9a-f]{64}$")) and (.blob.superrootProof.siblings | length > 0)' >/dev/null
```

The fields: `block_number`, `block_hash`, `is_finalized`, `proof_state`, `super_root_hash`, `batch_id`,
`verifiable_block`, `checks { receipt_found, tx_succeeded, proof_served, block_hash_matches, within_verifiable_range }`,
and `blob` (the V5 proof: `superroot`, `chainHeaders`, `superrootProof`, `blockProof`, `finality`).

### 3. Check it against the chain yourself

The block hash in the proof must equal the one your own RPC gives for the transaction's receipt.

```sh
RPC=${RPC:-https://mainnet.base.org}
MINE=$(curl -sS -m 30 -X POST "$RPC" -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$TX\"]}" | jq -r '.result.blockHash')
[ "$MINE" = "$(echo "$PROOF" | jq -r .block_hash)" ]
```

### 4. Check the chain is in the root

```sh
tf "$TAIFOON/root" | jq -e '(.root | test("^[0-9a-f]{64}$")) and (.chains_included | index('"$CHAIN"') != null) and .leaf_count > 0' >/dev/null
```

`GET /v1/root/chains` says what each chain contributed; `GET /v1/root/proof/{chain}/{block}` is the sibling path from one
block to the root; `GET /v1/proof/blocks/{chain}?blocks=a,b,c` proves up to 256 blocks in one call.

### 5. The transaction itself, decoded

Up to 25 transactions in one call: status, block, time, fee and every known event decoded.

```sh
tf "$TAIFOON/chain/tx?chain=$CHAIN&hashes=$TX" | jq -e '.txs[0].status == "success" and (.txs[0].events | type == "array")' >/dev/null
```

## Verify it works

```sh
echo "$PROOF" | jq -e '.tx == "'"$TX"'" and .chain_id == ('"$CHAIN"')' >/dev/null
echo "prove-a-transaction: proven in block $(echo "$PROOF" | jq -r .block_number), block hash equal to the chain's own"
```

## What it costs

Inside the free rate, nothing (30 a minute without a key, 90 with a free key). Past it a proof is 0.2 GRID (0.002 USDC) from the key's balance; `GET /v1/access` is the price list, `buy-access` tops a key up. The other proof kinds (log, order, transition, blocks): `prove-anything`.

## Next

- On Base the V5 verifier contract is
  [`0x2D475a53eAA8F9AC78B69bD2429275a622C644f8`](https://basescan.org/address/0x2D475a53eAA8F9AC78B69bD2429275a622C644f8);
  the proof API page is https://www.taifoon.io/docs/v5-proof-api.
- The same call as an MCP tool: `taifoon_proof_tx` (`mcp-server`).
- A transfer whose two legs are both provable: `bridge-with-proof`.
