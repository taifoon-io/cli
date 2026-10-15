---
name: send-through-the-pipe
description: "Send a message through the Taifoon coordination layer's pipe to any venue, chain or agent, read an inbox, ack what you received, and read where every message sits as a leaf under the root. Use when an agent or a service must hand a job, a delivery, a grade or a settlement to another party and wants the hand-off recorded, acknowledged and provable. Do NOT use for moving money by itself (a settle envelope is planned, never signed here) or for reading the chains (that is the proof group)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1 (the same routes answer at https://www.taifoon.io/v1); a free key for the send and the ack"
metadata:
  title: "Send through the pipe"
  category: "Tools"
  summary: "One queue under the layer: send an envelope, pull an inbox, ack a delivery, read its leaves under the root."
  use_when: "A message between two agents, venues or chains must be delivered, acknowledged and recorded."
  not_when: "You want to pay or settle by yourself, or you only need a transaction proof."
  first_call: "GET /v1/pipe/stats"
  success: "an envelope delivered, its ack recorded, its leaves named with their batch"
  verified: "2026-10-14"
---

# Send through the pipe

## What this is

The pipe is the one ack-and-delivery queue under the coordination layer (taifoon-io/coord `docs/COORD-PIPE.md`). An **envelope**
(`taifoon.pipe.envelope.v1`) names where it comes from, where it goes (a venue, a chain, an agent id, optionally an `http(s)://`
endpoint), the kind of message (`offer · hire · delivery · grade · settle · release · advert · cover · ack`) and a payload with its
keccak digest. The pipe queues it, delivers it (to an endpoint by HTTP, else to the receiver's inbox when the receiver reads it),
waits for the receiver's **ack**, and when none comes within `ttl_s` it marks the envelope lost, retries, and finally drops it by a
named handler. Every state change is a 406-byte transition of protocol `taifoon_pipe`, folded every 5 seconds into one batch root;
`GET /v1/pipe/status/{id}` lists the leaves with their batch and position. The batch root reaches the superroot once the layer's
sync loop is armed (an owner step); until then the status names the batch root and no superroot.

A send is one metered call of the key you hold: the free daily allowance first, then the key's plan or balance, then a 402 with
the same buy-credit steps every gateway call answers. The ack and every read are free.

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`. Reads need no key.
- A free key for the send and the ack: `POST /v1/register` (one free tenant per caller a day). Put it in `TAIFOON_API_KEY`.
  Without it the keyed steps below are skipped and say so; everything else runs.
- The payload is any text (a canonical record, see the skill `grade-the-stream`); its `payload_digest` is filled for you when
  you send none.

```sh
export TAIFOON=${TAIFOON:-https://coord.taifoon.dev/v1}
tf() { curl -sS -m 60 -H "X-Taifoon-Client: taifoon-skill-send-through-the-pipe" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
ME=${PIPE_ME:-erc8004:8453:96559}          # the agent id you read your inbox as (any id you own; this one is an example)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

## Pitfalls

1. Sending without `created_at`. The pipe refuses the envelope (`not an envelope: missing field created_at`): always set it.
2. Sending a `payload_digest` that is not keccak256 of the payload: refused by name. Send the payload alone and let the digest be
   filled, or compute keccak256 (not sha3-256) yourself.
3. Reading the wrong inbox. `GET /v1/pipe/inbox/{who}` takes the agent id, else the venue id, else the chain the envelope was sent
   `to`; a pull from the inbox IS the delivery (the state moves to `delivered`), so read it as the receiver, not as a spectator.
4. Expecting a superroot before the sync loop is armed. The status carries the batch root and the leaf positions now; the
   superroot field stays null until the owner's steps `superroot-sync-door` and `superroot-sync-armed` are done.
5. A `to.endpoint` that answers anything but 200 or 202: the envelope is retried, then dropped to the dead letter with the code
   (`GET /v1/pipe/dead`); it is never lost silently.
6. Taking a 402 for an outage. It is the key's allowance for the day used up: the answer names the credit to buy and when the
   allowance returns.

## Steps

### 1. What the pipe holds now

```sh
tf "$TAIFOON/pipe/stats" | jq -e '.by_state and (.batches | type == "number")' >/dev/null
tf "$TAIFOON/pipe/stats" | jq '{by_state, dead, batches, leaves}'
```

### 2. Send one envelope (keyed)

A delivery addressed to your own agent id, so you can read it from that inbox in the next step.

```sh
if [ -n "${TAIFOON_API_KEY:-}" ]; then
  BODY=$(jq -cn --arg now "$NOW" --arg me "$ME" '{schema:"taifoon.pipe.envelope.v1", kind:"delivery", created_at:$now,
    from:{venue:"coord", chain:"eip155:8453", agent:"skill-sender"}, to:{venue:"coord", chain:"eip155:8453", agent:$me},
    order_key:("skill:" + $now), payload:"{\"entity\":\"delivery\",\"text\":\"hello from the skill\"}", ttl_s:600}')
  SENT=$(tf -X POST "$TAIFOON/pipe/send" -d "$BODY")
  echo "$SENT" | jq -e '.id and .state == "queued"' >/dev/null
  ID=$(echo "$SENT" | jq -r .id); echo "sent $ID"
else
  echo "no TAIFOON_API_KEY: the send is skipped (register a free key to run it)"; ID=
fi
```

### 3. Pull the inbox: the pull is the delivery

```sh
tf "$TAIFOON/pipe/inbox/$ME?limit=5" | jq -e '.envelopes | type == "array"' >/dev/null
tf "$TAIFOON/pipe/inbox/$ME?limit=5" | jq '.envelopes[] | {id, state}'
```

### 4. Ack what you received (keyed)

The ack is an envelope of kind `ack` whose `reply_to` is the delivered id and whose payload names it.

```sh
if [ -n "${ID:-}" ]; then
  ACK=$(jq -cn --arg now "$NOW" --arg me "$ME" --arg id "$ID" '{schema:"taifoon.pipe.envelope.v1", kind:"ack", created_at:$now, reply_to:$id,
    from:{venue:"coord", chain:"eip155:8453", agent:$me}, to:{venue:"coord", chain:"eip155:8453", agent:"skill-sender"},
    order_key:("skill:" + $now), payload:({schema:"taifoon.pipe.ack.v1", envelope:$id} | tojson), sig:{scheme:"none", by:$me}}')
  tf -X POST "$TAIFOON/pipe/ack" -d "$ACK" | jq -e '.state == "acked" or .id' >/dev/null && echo "acked $ID"
else
  echo "nothing to ack (no send in step 2)"
fi
```

### 5. Where it sits: the leaves and their batch

```sh
LOOK=${ID:-$(tf "$TAIFOON/pipe/stats" | jq -r '.delivered[0].id // empty')}
if [ -n "$LOOK" ]; then
  tf "$TAIFOON/pipe/status/$LOOK" | jq -e '.envelope.id and (.leaves | type == "array")' >/dev/null
  tf "$TAIFOON/pipe/status/$LOOK" | jq '{state, acked_at, leaves: [.leaves[] | {state, batch, pos}]}'
fi
tf "$TAIFOON/pipe/batches?limit=1" | jq -e '.batches | type == "array"' >/dev/null
```

### 6. What was lost, what was dropped, and why

```sh
tf "$TAIFOON/pipe/lost" | jq -e '.envelopes | type == "array"' >/dev/null
tf "$TAIFOON/pipe/dead" | jq '[.envelopes[]? | .reason // .handler] | group_by(.) | map({why: .[0], n: length})'
```

## Premium: sealed envelopes (Team and Protocol plans)

For a client whose payloads must stay private, even from the coordination layer, the payload is sealed to the receiver with HPKE
(RFC 9180, base mode, X25519 + HKDF-SHA256 + ChaCha20-Poly1305). The pipe routes, accounts and proves on the header, which is bound to
the ciphertext as its AAD, and commits to the ciphertext's digest; it never sees the plaintext and holds no key. Sealed sends need a
running Team or Protocol plan (any other key gets `402 premium_required` with the plans that unlock it) and cost 0.001 USDC more per
envelope, taken from the plan's allowance first. The receiver makes its own X25519 key pair and publishes the public key; the sender:

```js
// pipe-sealed.mjs: one file over @hpke/core 1.9.0 + @hpke/chacha20poly1305 1.8.0 (MIT), shipped with the coordination SDK
import { sealEnvelope, openEnvelope } from './pipe-sealed.mjs';
const e = await sealEnvelope({ kind: 'delivery', from: { venue: 'x402-base' }, to: { endpoint: 'https://receiver.example/inbox' },
  order_key: 'sale:1' }, receiverPublicKey, JSON.stringify(genome), { sizeClass: 4096 });
// POST e to /v1/pipe/send with your X-API-Key; the receiver: await openEnvelope(e, receiverSecretKey)
```

Size classes (1, 4 or 16 KiB) pad the plaintext so the ciphertext length does not reveal it; larger payloads go by `payload_uri`.
An optional `plainCommitment` (keccak of the genome digest and a 32-byte salt) lets the sender later show a grader what was sent.
What is and is not protected: coord `docs/PIPE-SEALED.md`.

## Verify it works

```sh
tf "$TAIFOON/pipe/stats" | jq -e '(.by_state | type == "object") and (.batches >= 0)' >/dev/null && echo "the pipe answers"
```

## Next

- `grade-the-stream`: let Jev grade what the pipe carries, and read the grade as a leaf.
- `prove-anything`: once the sync loop is armed, the batch root of your envelope is provable against the superroot.
