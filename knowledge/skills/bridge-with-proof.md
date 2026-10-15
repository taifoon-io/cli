---
name: bridge-with-proof
description: "Move USDC between chains through the Taifoon coordination layer and prove each leg: POST /v1/compare prices one transfer across protocols, POST /v1/transfer/plan returns the exact unsigned calls with every fee itemised, GET /v1/transfer/{chain}/{tx} follows it to the destination mint, and GET /v1/proof/tx proves the burn. Use when an agent must plan, price, follow or prove a cross-chain USDC transfer (for example Base to Arc over Circle CCTP v2). Do NOT use for a proof of an arbitrary transaction (use prove-a-transaction) or to pay a seller on one chain (use x402-pay-and-get-paid)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1; your own wallet signs and sends"
metadata:
  title: "Bridge with proof"
  category: "Prove"
  summary: "Price a transfer, get the unsigned calls, follow it, prove the burn."
  use_when: "You plan, follow or prove a cross-chain USDC transfer."
  not_when: "You need a proof of some other transaction, or a same-chain payment."
  first_call: "POST /v1/transfer/plan"
  success: "a transfer in state minted with a proven burn"
  verified: "2026-10-03"
---

# Bridge with proof

## What this is

The layer plans a transfer, never sends it. `POST /v1/transfer/plan` answers an ordered list of contract calls with what
each costs; your wallet signs and sends them. `GET /v1/transfer/{chain}/{tx}` then reports the transfer's state from the
burn to the destination mint, and the burn is provable under the superroot like any transaction.

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`. No key needed.
- Amounts are in the token's smallest units: `"1000000"` is 1 USDC.
- A refusal carries `next_step.http.body`: a body of the right shape to send again.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-bridge-with-proof" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
WALLET=${WALLET:-0x000000000000000000000000000000000000dEaD}   # replace with your wallet: sender and recipient
BURN=${BURN:-0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a}   # a transfer from Base, already minted
```

## Pitfalls

1. Field names. The plan takes `src_chain_id`, `dst_chain_id`, `amount`, `sender`, `recipient`; the comparison takes
   `src_token`, `dst_token`, `input_amount`. `from_chain` or `token: "USDC"` answer 422 with the right shape in `next_step`.
2. Small amounts. The service fee has a floor (`fees.service_fee_floor_units`, 20000 units = 0.02 USDC on the route below);
   on 1 USDC the floor, not the basis points, decides. Read `amounts_usdc_units.expected_received` before you send.
3. Approving more than the amount. The plan's `approve` step is for exactly `amount`; skip it when the allowance covers it.
4. Quoting a time. `eta_seconds` comes from the protocol's finality tier (`eta_source`); it is an estimate, and
   `GET /v1/transfers` shows what recorded transfers took.
5. Waiting on the wrong chain. Status is read with the source chain id and the burn transaction.
6. Following `links.proof` from a transfer record on this host. Prove the burn with `GET /v1/proof/tx/{chain}/{tx}`.

## Steps

### 1. Where value can move

```sh
tf "$TAIFOON/chains" | jq -e '.chain_count > 0 and (.chains | map(select(.chain_id == 8453)) | .[0].usdc_address == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")' >/dev/null
```

### 2. Price the transfer across protocols

```sh
tf -X POST "$TAIFOON/compare" -d '{"src_chain_id":8453,"dst_chain_id":5042,"src_token":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","dst_token":"0x3600000000000000000000000000000000000000","input_amount":"10000000"}' \
  | jq -e '(.rows | length > 0) and (.best | type == "string") and (.rows[0] | has("eta_seconds") and has("gas_cost_usd"))' >/dev/null
```

One row per protocol: what arrives, what it costs, how long it takes, and whether the layer can execute it.

### 3. The exact calls to sign

```sh
PLAN=$(tf -X POST "$TAIFOON/transfer/plan" -d "{\"src_chain_id\":8453,\"dst_chain_id\":5042,\"amount\":\"1000000\",\"sender\":\"$WALLET\",\"recipient\":\"$WALLET\"}")
echo "$PLAN" | jq -e '.route.protocol == "cctp_v2" and .route.dst_domain == 26
  and (.steps | map(.step) == ["approve","bridge"]) and .steps[0].to == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  and (.amounts_usdc_units | has("expected_received") and has("service_fee") and has("circle_max_fee"))' >/dev/null
```

`steps[]` are `{ step, chain_id, to, data, value }` in order. `amounts_usdc_units` itemises `amount`, `service_fee`,
`circle_max_fee`, `burned` and `expected_received`. Nothing is signed or sent by the API. `POST /v1/bridge/plan` is the
same call.

### 4. Follow it

```sh
tf "$TAIFOON/transfer/8453/$BURN" \
  | jq -e '.state == "minted" and .terminal == true and (.mint_tx | test("^0x[0-9a-f]{64}$")) and (.transitions | length >= 2)' >/dev/null
```

`state` walks `burned → attested → minted`; `transitions[]` carries each step with its time and note; `mint_tx` is the
destination transaction once it lands. `GET /v1/transfer/watch/{chain}/{tx}` follows one transfer as it moves.

### 5. Prove the burn

```sh
tf "$TAIFOON/proof/tx/8453/$BURN" | jq -e '.ok and .proof_state == "proven" and .checks.tx_succeeded and .checks.block_hash_matches' >/dev/null
```

## Verify it works

```sh
tf "$TAIFOON/transfers?limit=1" | jq -e '(.records | type == "array") and (.eta_now | type == "object")' >/dev/null
echo "bridge-with-proof: chains, comparison, plan ($(echo "$PLAN" | jq -r .amounts_usdc_units.expected_received) units expected of 1000000), status and proof answered"
```

## What it costs

The plan itemises it. On Base to Arc for 1 USDC on 2026-10-03: service fee 20000 units (the floor; 10 bps above it), and
Circle's forwarding fee capped at `circle_max_fee`. Gas is paid by the sender on the source chain.

## Next

- Proof details and the independent check: `prove-a-transaction`.
- The plan as an MCP tool: `taifoon_bridge_plan` (`mcp-server`).
