---
name: buy-access
description: "Buy Taifoon API access for a key on any pay chain: GET /v1/access/quote?usdc=1..500&chainId= (Base 8453, Arbitrum One 42161, Arc 5042, Monad 143 in USDC; Robinhood Chain 4663 in USDG) or ?plan=builder-99|team-199|protocol-299 for the transfer to send and the message to sign, then POST /v1/access/topup or /v1/access/plan { tx, signature, chainId }. One balance pays calls, proofs, decoded reads, writes, grades and records. Also: read the key with GET /v1/access/key, /usage and /receipts, limit it (scopes, chains, spend caps, a rate cap, an end date, origins) and rotate it with POST /v1/tenant/keys. Use when an agent or its owner needs more than the free allowance, wants a monthly plan, or wants to limit or read what a key spends. Do NOT use to pay one call without a key (use x402-pay-and-get-paid) or to get GRID paid back (not offered)."
license: TSUL
compatibility: "bash, curl, jq; a wallet that can send the dollar token of a pay chain and sign a message (personal_sign) for the purchase itself; Taifoon coordination API v1 at https://coord.taifoon.dev/v1"
metadata:
  title: "Buy API access"
  category: "Buy"
  summary: "Read the price list, buy a balance or a monthly plan on any pay chain, limit the key, read its usage and receipts."
  use_when: "You need more than the free allowance, or want a key capped and scoped."
  not_when: "You are paying a single call with x402, or want GRID paid back."
  first_call: "GET /v1/access"
  success: "a quote on a chain, the plans, the key's standing and its usage read back"
  verified: "2026-10-05"
---

# Buy API access: top up a key

## What this is

API access is metered per call in GRID (1 GRID = 0.01 USDC of service).

- **A free key** (`POST /v1/register`) keeps its free allowance every day.
- **A key with a balance** runs at ten times the rate. Each call past the free allowance is debited at the list price:

| Product | Per call | Per 1,000 |
|---|---|---|
| RPC request | 0.1 GRID | 100 GRID (1.00 USDC) |
| Proof | 0.2 GRID | 200 GRID (2.00 USDC) |
| Decoded read | 0.05 GRID | 50 GRID (0.50 USDC) |
| Scanning read | 0.1 GRID | 100 GRID (1.00 USDC) |
| Write | 0.05 GRID | 50 GRID (0.50 USDC) |

Read the live numbers from `GET /v1/access`; never copy them from here.

**One balance pays everything metered**: calls past the free allowance, proofs, decoded reads, writes, grades and their
records. You send the dollar token of a pay chain from your own wallet to the payee, sign one message with that wallet, and
the key is credited: 100 GRID per 1 dollar, from 1 to 500 whole dollars per transaction.

| Chain | chainId | Token |
|---|---|---|
| Base | 8453 | USDC |
| Arbitrum One | 42161 | USDC |
| Arc | 5042 | USDC |
| Monad | 143 | USDC |
| Robinhood Chain | 4663 | USDG |

**A monthly plan** (builder-99, team-199, protocol-299) is 30 days of metered use at a better rate than a balance, with a
higher rate limit, paid up front by one exact transfer. Nothing renews by itself: a renewal is one more payment and starts
when the running period ends. The plan's allowance is spent before the balance and ends with the period.

## Before you start

- A key: `POST /v1/register` (no body) answers `api_key` once.
- For the top-up itself: a wallet (an EOA) holding USDC and a little ETH on Base. The commands below never sign or send.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 60 -H "X-Taifoon-Client: taifoon-skill-buy-access" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Sending an amount that was not quoted. Only an exact whole number of dollars from 1 to 500 (or exactly a plan's price),
   sent by the wallet that signs, to the payee in the quote, on the chain you name, counts. 1.5 is refused and nothing is credited.
2. Signing with another wallet. The message names your key, and only the wallet that sent the transfer may sign it.
3. Sending the transfer from a contract wallet. The top-up reads the transaction's sender; send it from an EOA.
4. Naming the wrong chain. The receipt is read on the chain in `chainId`. A Base payment claimed with another chainId is
   not found. A rolled key keeps the balance and the plan of the key it replaced.
5. Retrying a top-up and fearing a double credit. A transaction credits once. The same key sending it again gets
   `already: true`. Another key gets 409.
6. Reading a 402 as an outage. `code: budget` means the key's own cap (`reason: cap_day | cap_month`) or its balance
   (`reason: balance`). `next_step` and `top_up` say what lifts it.

## Steps

### 1. The products and prices

```sh
tf "$TAIFOON/access" | jq -e '.schema == "taifoon.access.v1" and (.products | length) == 6 and ([.products[].price.per_1000_grid] | all(. > 0)) and (.checkout.payee | test("^0x[0-9a-fA-F]{40}$"))' >/dev/null
```

### 2. Your key's standing

```sh
if [ -n "${TAIFOON_API_KEY:-}" ]; then
  tf "$TAIFOON/access/key" | jq -e '.ok and (.tier == "free" or .tier == "paid") and (.permissions.scopes | length) > 0 and has("balance")' >/dev/null
fi
```

### 3. The quote, on the chain you pay on

```sh
Q=$(tf "$TAIFOON/access/quote?usdc=1")
echo "$Q" | jq -e '.ok and .pay.chainId == 8453 and .pay.amount == "1.000000" and .credits.grid == 100 and (.pay.call.data | startswith("0xa9059cbb"))' >/dev/null
for C in 42161 5042 143 4663; do
  tf "$TAIFOON/access/quote?usdc=5&chainId=$C" | jq -e --argjson c "$C" '.ok and .pay.chainId == $c and .pay.amount_units == "5000000" and (.pay.payee | test("^0x[0-9a-fA-F]{40}$"))' >/dev/null
done
```

A plan is quoted the same way, for exactly its price:

```sh
tf "$TAIFOON/access/plan" | jq -e '(.plans | map(.id)) == ["builder-99","team-199","protocol-299"] and (.paid_on | length) == 5' >/dev/null
tf "$TAIFOON/access/quote?plan=builder-99&chainId=42161" | jq -e '.ok and .product == "plan" and .pay.amount_units == "99000000"' >/dev/null
```

With a key, `sign.message` is the exact text to sign. Without one it is null, and the steps say to get a key first.

### 4. Pay and sign (your wallet, not this script)

1. Send `pay.call` (`to`, `data`, `value: 0x0`) on the quoted chain from your wallet.
2. Take the transaction hash.
3. Sign `sign.message` with the hash filled in, using personal_sign from the same wallet.

```text
cast send <pay.call.to> <pay.call.data> --rpc-url https://mainnet.base.org --private-key …   # or any wallet
cast wallet sign "<sign.message with the tx hash>"                                          # the same wallet
```

### 5. Credit the key

```sh
if [ -n "${TX:-}" ] && [ -n "${SIG:-}" ]; then
  tf -X POST "$TAIFOON/access/topup" -d "{\"tx\":\"$TX\",\"signature\":\"$SIG\",\"chainId\":${CHAIN_ID:-8453}}" | jq -e '.ok and (.balance.grid > 0)' >/dev/null
fi
```

| Answer | Means |
|---|---|
| `credited { grid, usdc }` and `balance` | the key is credited |
| 402 `not_paid` | the amount is not a whole number of dollars from the sender to the payee |
| 409 `already_credited` | another key took that transaction, or it bought something else |
| 410 `claim_expired` | the payment is older than 7 days |
| 403 `signature` | the answer carries the message and the signer it expects |
| 404 `no_receipt` | not mined or not deep enough yet: wait a few seconds and send it again |

A plan is claimed with `POST /v1/access/plan { plan, tx, signature, chainId }`. A payment that was sent and never claimed is
credited by `POST /v1/access/claim { tx, signature, chainId }`; without a signature it answers the messages to sign.

### 6. Cap and scope a key

One more key, labelled, for a bot that may only read chains and prove, spending at most 50 GRID a day:

```text
POST /v1/tenant/keys { "action": "create", "label": "indexer", "scopes": ["rpc", "proofs"], "cap_day_grid": 50, "cap_month_grid": 1000 }
POST /v1/tenant/keys { "action": "update", "prefix": "tfr_free_…", "origins": ["https://app.example.com"] }   # null clears a field
POST /v1/tenant/keys { "action": "update", "prefix": "tfr_free_…", "cap_day_usdc": 2, "per_minute": 120, "chains": [8453], "expires_at": "2027-01-01T00:00:00Z" }
POST /v1/tenant/keys { "action": "roll", "env": "live", "grace_hours": 24 }   # the old key keeps working 24 h; the new one holds its balance and plan
```

| A key… | Gets |
|---|---|
| without the family's scope | 403 `scope` |
| called from elsewhere | 403 `origin` |
| over its cap | 402 `budget` |
| past its end date | 403 `expired` |
| on a chain it is not limited to | 403 `chain` |

A key that was limited to scopes cannot manage keys unless it carries `manage: true`.

## Verify it works

```sh
if [ -n "${TAIFOON_API_KEY:-}" ]; then
  tf "$TAIFOON/access/usage?window=7d" | jq -e '.ok and (.families | has("rpc") and has("proofs") and has("events")) and (.total.calls >= 0)' >/dev/null
fi
echo "buy-access: price list, quote and standing read"
```

## What it costs

The purchase is the dollars you send plus that chain's gas. 1 dollar credits 100 GRID, spent per call only past the free
allowance. A plan costs its price for 30 days. Reading the quote, the plans, the standing and the usage costs nothing.

## Next

- Spend it on chain reads: `rent-rpc`. On proofs: `prove-anything`.
- Give the key to an agent: `wrap-in-an-agent`.
