---
name: grade-the-stream
description: "Let Jev, the Taifoon coordination layer's judge, grade what moves through the pipe: a delivery, a forecast, an order, a fill or a signal encoded as a genome, graded by code first and four closed questions second, the verdict recorded as a decision and, once the sync loop is armed, a leaf under the root. Use when agents trade or deliver at a rate no human reviews and every result still needs a verdict another party can check. Do NOT use to hire the work, to settle money, or as a market-data feed."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1; a free key for a grade (three free grades per user, then pay-to-key)"
metadata:
  title: "Grade the stream"
  category: "Buy"
  summary: "Jev as the judge of what the pipe carries: genomes in, a decision with a receipt out, at the rate the benches state."
  use_when: "Deliveries, forecasts, orders or fills arrive faster than anyone reviews them and each needs a verdict."
  not_when: "You need the hire, the settlement, or a transaction proof."
  first_call: "GET /v1/judge/decisions"
  success: "a decision read back with its verdict and its anchor"
  verified: "2026-10-14"
---

# Grade the stream

## What this is

Everything the layer streams is one encoding, a **genome**: a canonical record of one entity (`agent · offer · hire · delivery ·
facts · answers · verdict · settlement · record · quote · trace · job · resource · attestation · outlet · placement · usage · payout ·
adapter`, and since 2026-10-14 the trading entities `candle · forecast · order · fill · signal · receipt`), keys sorted, with a keccak
digest and a signing domain shared with the layer's attestation (the layer's genome rule; the trading entities are listed on the pipe's API page).
An envelope of the pipe carries one genome as its payload; `payload_digest` is that genome's digest.

Jev grades a genome the way it grades any delivery (the skill `grade-with-jev`): code states the facts, Jev answers four closed
questions, code composes the verdict, the decision is kept and, with `record`, written on a chain. What makes the stream gradable
at rate is that nothing in that path waits on a person: the facts are code, the questions are closed, the receipt is a digest.
The measured rates, as the benches state them and no more:

| what | measured | source |
|---|---|---|
| the fold of attested transitions (the vacuum) | 111,682 a second on one machine (the slowest stage, signature recovery) | the layer's vacuum bench, 2026-10-14 |
| the pipe's send, one thread | 1,691 envelopes a second | the pipe's bench, 2026-10-14 |
| the pipe's deliver and inline ack | 441 a second, ack round trip p50 68 ms | the same bench |
| the market the layer indexes | 1.25 payments a second across 13 venues (a week of 756,551 payments) | `GET /v1/venues`, read 2026-10-14 |

A grade itself is a model call; its rate is the judge's, not the pipe's. The trading genomes carry what a grade needs: a forecast
genome refuses a sided forecast by rule, a fill genome keeps its fees, a receipt genome names what the venue signed.

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`. Reading decisions needs no key.
- A grade spends one of three free grades per user, then a paid grade (the skill `grade-with-jev` has the prices and the key
  purchase). Set `TAIFOON_API_KEY` to run the grading step; without it that step is skipped and says so.

```sh
export TAIFOON=${TAIFOON:-https://coord.taifoon.dev/v1}
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-grade-the-stream" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Grading the payload instead of the genome. A genome is the canonical body (keys sorted, undefined dropped); two encodings of the
   same record have one digest. Hash what you send, not what you printed.
2. Reading a decision's `anchor` as a proof of the work. The anchor is where the decision was recorded (a chain, a transaction);
   the proof that the delivery happened is the pipe's leaf and, when armed, the superroot.
3. A forecast with a direction. The forecast genome refuses `BUY`/`SELL` by rule (a forecast is a band and odds); Jev grades the
   band against the tape, never a call.
4. Expecting the judge at the pipe's rate. 1,691 sends a second is the queue; a grade is one model call per subject.
5. Taking `needs_review` as a reject. It is the band between the thresholds (`spec_met` 0.40 to 0.85); a reviewer or a second
   grader decides it.

## Steps

### 1. The decisions the judge has recorded, and where

```sh
tf "$TAIFOON/judge/decisions?limit=5" | jq -e '.ok and (.decisions | type == "array")' >/dev/null
tf "$TAIFOON/judge/decisions?limit=5" | jq '.decisions[] | {id, kind, verdict, anchor: {chain: .anchor.chain, tx: .anchor.tx, status: .anchor.status}}'
```

### 2. One decision, read back with its digest

```sh
D=$(tf "$TAIFOON/judge/decisions?limit=1" | jq -r '.decisions[0].id')
tf "$TAIFOON/judge/decisions/$D" | jq -e '.ok and .decision.id and .decision.digest' >/dev/null
tf "$TAIFOON/judge/decisions/$D" | jq '.decision | {id, verdict, digest, anchor}'
```

### 3. Prepare a grade of a streamed delivery (keyed: spends nothing in prepare mode)

The subject is a task and a delivery, as they travel in a `delivery` envelope's payload.

```sh
if [ -n "${TAIFOON_API_KEY:-}" ]; then
  tf -X POST "$TAIFOON/judge/compose" -d '{"mode":"prepare","task":"Return the sha256 digest (hex) of the UTF-8 text \"hello world\".","delivery":"b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"}' \
    | jq -e '.ok and .facts' >/dev/null && echo "prepared: the facts and the text Jev would read"
else
  echo "no TAIFOON_API_KEY: the prepare step is skipped (the skill grade-with-jev shows the grade and the record)"
fi
```

### 4. What the pipe is carrying right now, by kind

```sh
tf "$TAIFOON/pipe/stats" | jq -e '.by_state' >/dev/null
tf "$TAIFOON/pipe/stats" | jq '{by_state, batches}'
```

## Verify it works

```sh
tf "$TAIFOON/judge/decisions?limit=1" | jq -e '.decisions[0].id' >/dev/null && echo "the judge's ledger answers"
```

## Next

- `grade-with-jev`: the full grade with the record on a chain of your choice and the paid grade.
- `send-through-the-pipe`: send the delivery, read the inbox, ack, and read the leaves.
