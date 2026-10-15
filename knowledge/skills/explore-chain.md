---
name: explore-chain
description: "Use the Taifoon API like any block explorer, with a proof on every answer: look up a block, a transaction or a receipt (GET /v1/chain/{chain}/block|tx|tx/{hash}/receipt), read logs like eth_getLogs (/v1/chain/{chain}/logs), scan an account for the events and transactions that name it (/v1/chain/{chain}/address/{addr}/events|txs), and follow a protocol's state transitions (/v1/transitions/{protocol}). Answers come from the layer's own indexes (held block headers and their blooms, block trees, the superroot, protocol trees); each says source indexed or fetched and carries proof.verified. Use when an agent must find what happened on chain and show it is inside the superroot. Do NOT use to send transactions, to read contract state with eth_call (use rent-rpc), or for the on-chain verifier calldata of one log (use prove-anything)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1; a free key (POST /v1/register) for the higher rate"
metadata:
  title: "Explore a chain, with proofs"
  category: "Prove"
  summary: "Blocks, transactions, receipts, logs, account scans and protocol transitions, each answer tied to the superroot."
  use_when: "You need explorer reads (a tx, an account's events, a protocol's history) and proof that they are inside the root."
  not_when: "You need to write, call a contract view, or post a proof to the on-chain verifier."
  first_call: "GET /v1/chain/{chain}/tx/{hash}"
  success: "a transaction, an account scan on three chains and an order's transitions answered with proof.verified true"
  verified: "2026-10-04"
---

# Explore a chain, with proofs

## What this is

The coordination layer answers explorer reads from what it already holds, instead of walking blocks over a public RPC:

| Read | Call | From |
|---|---|---|
| Block | `GET /v1/chain/{chain}/block/{latest\|finalized\|number\|hash}` | the header store (`?txs=1` adds the hashes, read once) |
| Transaction | `GET /v1/chain/{chain}/tx/{hash}` | kept after the first read; events decoded |
| Receipt | `GET /v1/chain/{chain}/tx/{hash}/receipt` | the same; each log links its inclusion proof |
| Logs | `GET /v1/chain/{chain}/logs?address=&topic0=&from=&to=` | header blooms pick the blocks, only those are read |
| Account | `GET /v1/chain/{chain}/address/{addr}/events` or `/txs` | the same blooms, for the address as emitter or topic |
| Transitions | `GET /v1/transitions/{protocol}?key=` | the protocol trees; no chain is read |

Every answer carries:

- `source`: `indexed` means no RPC call was made. `fetched` means a part was read once from the chain's rotation and kept
  once final.
- `cost`: RPC requests, headers checked, bloom candidates, blocks read.
- `proof`: the block hash is the leaf at index = block number in the chain's block tree, and that tree is the chain's leaf in
  the superroot. The layer recomputes both before it answers (`verified`). `checks.block_hash_matches` ties a transaction to
  the hash in its own receipt.

## Before you start

- Reads need no key inside the visitor rate. A free key (`POST https://coord.taifoon.dev/v1/register`) has its own budget.
- Lookups are decoded reads (0.05 GRID past the free rate). Account scans are scanning reads (0.1 GRID). `GET /v1/access` has the prices.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-explore-chain" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Reading `ok: true` as proven. Read `proof.status`. `proven` means the block is in the tree, the tree is in the
   superroot, and the block is at or below the finalized head. `not_final` means the same math holds but the block is newer
   than that head: ask again later. `pending` means it is newer than the tree's tip. `not_held` means it was never collected.
2. Asking for a whole chain. A logs query needs an address or a topic, and a window over 10,000 blocks becomes a scan job
   (HTTP 202 with `job.poll`). Page with `next_cursor` instead of widening the window.
3. Expecting plain native transfers in an account scan. The scan reads logs blooms. A transfer that emitted no log is not
   in a bloom, so `coverage.sees` says what is covered.
4. Treating `final: false` as an error. The default window ends at the tree tip, which is newer than the finalized head.
   Name `to` at or below `block/finalized` for answers that never change.
5. Guessing an order key. It is `<protocol>:<chain>:<id>`, for example `erc8183:8453:81435`.
   `GET /v1/protocols/proven` lists the protocols.

## Steps

### 1. Look up a transaction with its proof

A job created on Virtuals ACP v3 (ERC-8183) on Base:

```sh
TX=0xc32917e9b8dcbe96a51449d446c89b808e7c784737bef83ad58e7f04400b4d95
tf "$TAIFOON/chain/8453/tx/$TX" | jq -e '.tx.status == "success" and .proof.status == "proven" and .proof.checks.block_hash_matches and (.proof.anchor.superroot | test("^0x[0-9a-f]{64}$"))' >/dev/null
tf "$TAIFOON/chain/8453/tx/$TX/receipt" | jq -e '(.receipt.logs | length) > 0 and (.receipt.logs[0].proof_url | test("/v1/proof/log/8453/"))' >/dev/null
```

### 2. The finalized block, from the header store

```sh
tf "$TAIFOON/chain/8453/block/finalized" | jq -e '.source == "indexed" and .final and .proof.verified and .cost.rpc_calls == 0' >/dev/null
```

### 3. Scan an account across chains

Circle's CCTP TokenMessengerV2 has the same address on Base, Arbitrum One and Arc. Its events in each chain's newest 2,000 blocks:

```sh
A=0x28b5a0e9c621a5badaa536219b3a228c8168cf5d
for C in 8453 42161 5042; do
  tf "$TAIFOON/chain/$C/address/$A/events?limit=5" | jq -e '.ok and (.coverage.held_headers > 0) and (.cost.headers_checked > 0) and ((.events | length) == 0 or .proof.verified)' >/dev/null
done
```

### 4. Logs like eth_getLogs, paged

USDC Transfer events on Arc, five rows, then the next page:

```sh
T=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
P1=$(tf "$TAIFOON/chain/5042/logs?topic0=$T&limit=5")
echo "$P1" | jq -e '(.logs | length) >= 5 and .logs[0].decoded.event == "Transfer" and .proof.verified and (.next_cursor | type == "number")' >/dev/null
tf "$TAIFOON/chain/5042/logs?topic0=$T&limit=5&cursor=$(echo "$P1" | jq -r .next_cursor)" | jq -e '.logs[0].block_number >= ('"$(echo "$P1" | jq -r .next_cursor)"')' >/dev/null
```

### 5. Follow a protocol's transitions

One order's lifecycle, then the newest transitions of the Across V3 set:

```sh
tf "$TAIFOON/transitions/erc8183?key=erc8183:8453:81435" | jq -e '.current_state == "Settled" and ([.transitions[].to_state] | index("Funded") != null) and .proof.verified and .source == "indexed"' >/dev/null
tf "$TAIFOON/transitions/across_v3?limit=3" | jq -e '(.transitions | length) == 3 and .proof.checks.history_in_root and .proof.checks.protocol_in_superroot' >/dev/null
```

## Verify it works

Check the proof against a second source: the block hash the chain's own receipt names, read through the RPC gateway, equals
the hash the proof holds as the leaf of the block tree.

```sh
LEAF=$(tf "$TAIFOON/chain/8453/tx/$TX" | jq -r '.proof.blocks[0].hash')
curl -sS -m 60 -X POST https://coord.taifoon.dev/gw/rpc/8453 -H 'content-type: application/json' -H "X-Taifoon-Client: taifoon-skill-explore-chain" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$TX\"]}" | jq -e --arg h "$LEAF" '.result.blockHash == $h' >/dev/null
echo "explore-chain: a transaction, a block, an account on three chains, logs and transitions, each under the superroot"
```

To recompute the proof yourself, `?proof=full` returns the multiproof. In TypeScript with viem:

```text
leaf hashes = proof.multiproof.blockTree.leaves (index = block number); multiRoot(blockTree) must equal anchor.chain_root
keccak256(encodePacked(uint64 chainId, uint64 tip_block, bytes32 tip_hash, bytes32 chain_root, uint64 twig_count))
  folded with multiproof.l3_siblings at anchor.chain_index must equal anchor.superroot
```

## What it costs

Inside the free rate, nothing. Past it, a lookup, a logs page or a transition page is a decoded read (0.05 GRID, 0.0005 USDC),
and an account scan or a scan-job step is a scanning read (0.1 GRID, 0.001 USDC). Each answer's `cost` says how many RPC calls it made.

## Next

- The same as MCP tools: `taifoon_chain_lookup`, `taifoon_chain_logs`, `taifoon_account_scan`, `taifoon_scan_job`,
  `taifoon_transitions` (`wrap-in-an-agent`).
- A stock JSON-RPC client with proofs on request: `rent-rpc` (`taifoon_getProof`).
- The calldata for the on-chain verifier of one log: `prove-anything`.
