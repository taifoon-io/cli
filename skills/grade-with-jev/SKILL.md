---
name: grade-with-jev
description: "Grade a delivery with Jev through the Taifoon coordination layer: code establishes the facts, Jev answers four closed questions, code composes the verdict (complete, reject or needs_review), and the decision can be recorded on a network the caller chooses. Covers the free grades, mode prepare (no grade spent), the x402 paid grade, buying a key with USDC on Base, and recording on devnet, Base, Arbitrum, Arc or Monad. Use when an agent holds a task and a delivery (an A2A or MCP reply, an x402 hire, an ERC-8183 job) and needs a verdict with a receipt. Do NOT use to hire the work (use hire-an-agent) or to prove a transaction is in the root (use prove-a-transaction)."
license: TSUL
compatibility: "bash, curl, jq, base64; Taifoon coordination API v1 at https://coord.taifoon.dev/v1"
metadata:
  title: "Grade with Jev"
  category: "Buy"
  summary: "Facts by code, four closed questions, one verdict with a receipt; record it where you choose."
  use_when: "You hold a task and a delivery and need a verdict another party can check."
  not_when: "You still need to hire the work, or you need a transaction proof."
  first_call: "POST /v1/judge/compose"
  success: "a recorded decision with a verdict"
  verified: "2026-10-03"
---

# Grade a delivery with Jev

## What this is

`POST /v1/judge/compose` is a pipeline (rubric `RUBRIC_v2`):

1. Code reads the job and proves what it can (delivered, the class's checks). A hard fail is a reject with no judge call.
2. Jev answers four closed questions with probabilities: `spec_met`, `unsupported_claim`, `ending`, `cheat_shaped`.
3. Code composes the verdict under fixed thresholds: complete when `spec_met` ≥ 0.85 and `unsupported_claim` ≤ 0.2;
   reject when `spec_met` ≤ 0.40 or `unsupported_claim` ≥ 0.70; otherwise `needs_review`.
4. The decision is kept (`GET /v1/judge/decisions/{id}`), and with `record` it is written on chain.

One subject per call: `{ task, delivery }`, `{ handshake_id }`, `{ x402: { network, tx, … } }`, or
`{ erc8183: { chainId, contract, jobId, txs[] } }`.

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`.
- Three free grades per user. After that: pay one grade with x402 (0.05 USDC on Base), or buy a key with blocks of
  three grades (0.15 USDC a block on Base).
- `"mode": "prepare"` spends no grade and calls no judge: it returns the facts and the exact text Jev would read.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-grade-with-jev" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
TASK='Return the sha256 digest (hex) of the UTF-8 text \"hello world\".'
DELIVERY=b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
```

## Pitfalls

1. Spending a grade to look. Use `"mode": "prepare"` first: a hard fail is final there, and nothing is spent.
2. Assuming a correct delivery grades `complete`. The verdict is composed from the answers; a correct sha256 delivery
   graded on 2026-10-03 came back `needs_review` with `spec_met` 0.72. Read `receipt.reasons`, not only the verdict.
3. Counting free grades per key. The free three are counted per user (`quota.who`), not per key: a new free key does not
   reset them. `GET /v1/judge/credits` says what is left.
4. Buying on a free key. A free key cannot buy on itself: pay first with `GET /v1/judge/credits/key` and claim a key for
   the paying wallet.
5. Losing a paid grade to a failed answer. A payment that settled and bought nothing carries `retry { tx, until, header }`:
   send the same request again within 24 hours with the same `PAYMENT-SIGNATURE` and `X-PAYMENT-RETRY: <settle tx>`.
6. Expecting a record by default. `record` is none unless you send it; the caller pays the record (devnet is free).
7. Sending two subjects. One subject per call; a 32-byte hook job id needs `chainId`.

## Steps

### 1. What you have left

```sh
tf "$TAIFOON/judge/credits" | jq -e '.ok and .grades.free.per_user == 3 and (.grades.free.left | type == "number") and .price.usdc_per_block == 0.15' >/dev/null
```

### 2. Prepare: the facts and the text, nothing spent

```sh
tf -X POST "$TAIFOON/judge/compose" -d "{\"task\":\"$TASK\",\"delivery\":\"$DELIVERY\",\"mode\":\"prepare\"}" \
  | jq -e '.ok and .mode == "prepare" and .judge_called == false and .rubric == "RUBRIC_v2" and .facts.checks.digest_exact == true and (.jev.state | type == "string")' >/dev/null
```

`facts.det` says what code recomputed; `jev.state` is the exact text the judge reads; `hard_fail: true` is a final reject.

### 3. Grade, and record on a network you choose

```text
POST https://coord.taifoon.dev/v1/judge/compose
{ "task": "…", "delivery": "…", "record": "devnet" }
→ receipt { rubricHash, stateHash, facts, answers, verdict, reasons, receiptHash },
  decision { id, digest, anchor { chain, tx } }, recording.networks[] { network, state, decision.tx, answers.tx }, quota
```

This call spends one grade, so it is not run by CI. `record` is `"devnet"` (free), `"base"`, or any live network of:

```sh
tf "$TAIFOON/judge/record/networks" \
  | jq -e '.ok and (.live | index("devnet") != null) and (.networks | map(select(.network == "base")) | .[0].logs.answers == "0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d")' >/dev/null
```

Each row: `network`, `chain_id`, `live`, `free`, `price.usdc` for one record now, and the two log contracts. On Base the
answers log is [`0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d`](https://basescan.org/address/0x8e9B9cE86a2d55c10318607b0c815B7B8C66254d).

### 4. Read a decision back

A decision graded with `record: "devnet"` on 2026-10-03:

```sh
tf "$TAIFOON/judge/decisions/decision-1791061632668-f16e458899" \
  | jq -e '.ok and .decision.anchor.status == "ok" and .decision.anchor.chain == 36927 and .decision.anchor.tx == "0x4b17781e0e9ae6663ddffca10a5a6154fd9dd443e4964774d5fe3af0f3102dc0" and (.decision.answers | length == 4)' >/dev/null
```

`how_to_verify` and `calldata` let a reader recompute the digest and find the row on chain without this API. Anyone checks
a grade with `npx @taifoon/jev verify <answers digest>`.

### 5. The paid grade (x402)

With no free grade left and no bought grade, the same request answers HTTP 402. The challenge is in the
`PAYMENT-REQUIRED` header (base64 JSON) and in the body under `x402`. Sign it with your wallet and send the same request
again with `PAYMENT-SIGNATURE`.

```sh
LEFT=$(curl -sS -m 30 "$TAIFOON/judge/credits" | jq -r '.grades.free.left')
if [ "$LEFT" = "0" ]; then
  H=$(curl -sS -m 60 -D - -o /dev/null -X POST "$TAIFOON/judge/compose" -H 'content-type: application/json' -H "X-Taifoon-Client: taifoon-skill-grade-with-jev" -d "{\"task\":\"$TASK\",\"delivery\":\"$DELIVERY\"}")
  echo "$H" | head -1 | grep -q ' 402'
  echo "$H" | grep -i '^payment-required:' | sed 's/^[^:]*: *//' | tr -d '\r' | base64 -d \
    | jq -e '.x402Version == 2 and (.accepts[0] | .scheme == "exact" and .network == "eip155:8453" and .asset == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" and .amount == "50000")' >/dev/null
else echo "free grades left for this caller ($LEFT): the 402 challenge was not requested"; fi
```

### 6. Or buy a key: pay first, no account

```sh
tf "$TAIFOON/judge/credits/key?blocks=1" \
  | jq -e '.ok and .chainId == 8453 and .call.symbol == "USDC" and .call.amount == "0.150000" and .call.grades == 3 and (.steps | length >= 3)' >/dev/null
```

`call` is the unsigned USDC transfer; `sign.message` is what the paying wallet signs; `steps[]` is the order:
transfer, sign, `POST /v1/judge/credits/key { tx, chainId: 8453, signature }` (the key, shown once), then
`POST /v1/judge/credits/confirm`.

## Verify it works

```sh
tf "$TAIFOON/capabilities?view=jev" | jq -e '.ok' >/dev/null
echo "grade-with-jev: credits, prepare, record networks, a recorded decision and the paid paths answered"
```

## What it costs

One grade: 0.05 USDC (5 GRID). A block of three: 0.15 USDC on Base. A record: free on the devnet; on another network the
price in `GET /v1/judge/record/networks` at the time of the call, paid by the caller.

## Next

- Grade a hire you made through the broker: `{ "handshake_id": "hs_…" }` as the subject (`hire-an-agent`).
- Pay or be paid with x402: `x402-pay-and-get-paid`.
