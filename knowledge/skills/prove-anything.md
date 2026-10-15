---
name: prove-anything
description: "Prove that something happened under the Taifoon superroot, by kind: a transaction (GET /v1/proof/tx), one event log with calldata for the on-chain verifier (/v1/proof/log), an order's whole lifecycle (/v1/proof/order), given transitions of a protocol set in order (/v1/proof/transition), or up to 256 blocks (/v1/proof/blocks), for any protocol set in GET /v1/protocols/proven. Use when an agent must show a counterparty, a contract or an auditor that a payment, an event, a job's lifecycle or a protocol's state change is inside the root, or must check such a claim. Do NOT use to grade whether work met its spec (use grade-with-jev), for plain chain reads (use rent-rpc), or for one transaction only when you also want the independent check walked through (use prove-a-transaction)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1"
metadata:
  title: "Prove anything"
  category: "Prove"
  summary: "Five proof kinds over one root: tx, log, order, transition, blocks, for any protocol set."
  use_when: "You must show or check that a transaction, event, order lifecycle or transition is inside the root."
  not_when: "You need a quality verdict, or plain chain reads."
  first_call: "GET /v1/protocols/proven"
  success: "each of the five kinds answered with its anchor in the root"
  verified: "2026-10-04"
---

# Prove anything under the superroot

## What this is

The layer folds every chain it includes into one superroot about every 10 seconds. Each protocol set it decodes (its
contracts, events and order machine) adds a history root and a state root, and those are committed under the same superroot.
One API answers five kinds of proof:

| Kind | Call | Proves |
|---|---|---|
| tx | `GET /v1/proof/tx/{chain}/{tx}` | the transaction's block is under the root, with the checks made |
| log | `GET /v1/proof/log/{chain}/{tx}?log_index=` | one event log: receipt trie path, block tree, anchor, and `calldata` for `verifyLogAt` |
| order | `GET /v1/proof/order/{protocol}/{key}` | an order's whole lifecycle (or its absence) in a protocol set |
| transition | `GET /v1/proof/transition/{protocol}?seqs=0,1,2` | given transitions, in order (up to 256) |
| blocks | `GET /v1/proof/blocks/{chain}?blocks=a,b` | up to 256 blocks of one chain |

`GET /v1/protocols/proven` lists every protocol set inside the root: its transitions, orders and roots, and how current
each source is.

## Before you start

- No key is needed inside the free rate. With a key, proofs run at 90 a minute (900 with a balance). A key limited by scopes
  needs `proofs`.
- Past the free rate a proof costs 0.2 GRID (0.002 USDC). `GET /v1/access` has the price list.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-prove-anything" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Reading `ok: true` as proven. On a transaction proof read `proof_state` and every entry of `checks`. `not_final` means the
   block is not final yet: ask again.
2. Guessing a log index. `log_index` is the log's index in its block, as `eth_getLogs` reports it (`logIndex`), not its
   position in the transaction.
3. Guessing an order key. It is `<protocol>:<chain>:<id>` as the protocol set names it (for example `erc8183:8453:81401`). An
   order that is not there proves absent (`state.present: false`), which is an answer, not an error.
4. Asking for more than 256 sequence numbers or blocks in one call. Page it.
5. Comparing a proof's root with a later root. The root changes about every 10 seconds, and a proof is under its own
   `batchId`. Keep the blob.
6. Expecting a transaction proof on every committed chain. `GET /v1/protocols/decoders` (`chains`) says which chains are
   read per transaction.

## Steps

### 1. The protocol sets inside the root

```sh
SETS=$(tf "$TAIFOON/protocols/proven")
echo "$SETS" | jq -e '(.protocols | length) > 0 and (.protocols[0].historyRoot | test("^0x[0-9a-f]{64}$"))' >/dev/null
P=$(echo "$SETS" | jq -r '[.protocols[] | select(.transitions > 2)][0].protocol')
```

### 2. Transitions of a protocol set, in order

```sh
tf "$TAIFOON/proof/transition/$P?seqs=0,1,2" | jq -e '(.anchor.historyRoot | test("^0x[0-9a-f]{64}$")) and (.anchor.batchId > 0)' >/dev/null
```

### 3. An order's lifecycle (or its absence)

```sh
tf "$TAIFOON/proof/order/erc8183/erc8183:8453:81401" | jq -e 'has("anchor") and has("state")' >/dev/null
```

### 4. A transaction, and one of its logs

A USDC burn on Base. Its logs are read from the gateway, so the index is the block's own.

```sh
TX=0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a
tf "$TAIFOON/proof/tx/8453/$TX" | jq -e '.ok and .checks.receipt_found and .checks.tx_succeeded and .checks.block_hash_matches' >/dev/null
BN=$(tf "$TAIFOON/proof/tx/8453/$TX" | jq -r '.block_number')
LI=$(curl -sS -m 60 -X POST https://coord.taifoon.dev/gw/rpc/8453 -H 'content-type: application/json' -H "X-Taifoon-Client: taifoon-skill-prove-anything" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{\"fromBlock\":\"$(printf '0x%x' $BN)\",\"toBlock\":\"$(printf '0x%x' $BN)\",\"address\":\"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\"}]}" \
  | jq -r --arg tx "$TX" '[.result[] | select(.transactionHash == $tx)][0].logIndex')
tf "$TAIFOON/proof/log/8453/$TX?log_index=$(( LI ))" | jq -e '(.calldata | test("^0x[0-9a-f]+$")) and has("anchor") and has("receipt")' >/dev/null
```

### 5. Blocks of a chain

```sh
V=$(tf "$TAIFOON/proof/verifiable/8453" | jq -r '.chainHeaders[0].blockNumber')
tf "$TAIFOON/proof/blocks/8453?blocks=$(( V - 10 )),$(( V - 11 ))" | jq -e 'type == "object"' >/dev/null
```

## Verify it works

```sh
tf "$TAIFOON/root" | jq -e '(.chains_included | index(8453) != null) and .leaf_count > 0' >/dev/null
echo "prove-anything: transitions of $P, an order, a transaction, its log and two blocks, all under the root"
```

## What it costs

Inside the free rate, nothing. Past it, 0.2 GRID (0.002 USDC) a proof from the key's balance. The root, its chains and the
list of proven protocols are never charged.

## Next

- The log proof's `calldata` goes to `verifyLogAt` on the V5 verifier on Base,
  [`0x2D475a53eAA8F9AC78B69bD2429275a622C644f8`](https://basescan.org/address/0x2D475a53eAA8F9AC78B69bD2429275a622C644f8).
- The independent check of one transaction against your own RPC: `prove-a-transaction`.
- Add your own protocol set: `onboard-a-protocol`.
- The same as one MCP tool: `taifoon_prove` (`wrap-in-an-agent`).
