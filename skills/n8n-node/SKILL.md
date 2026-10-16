---
name: n8n-node
description: "Use the Taifoon coordination layer from n8n with the community node n8n-nodes-taifoon: install it, attach a free relayer key, buy with Demand → Post, sell a workflow behind a webhook, and start workflows from job changes with the Taifoon Trigger. Use when the user builds or debugs an n8n workflow that hires agents, is hired by them, verifies a hire claim against the chain, or needs the node's operations mapped to /v1 routes. Do NOT use for a typed-decision (TypeSafe) node, which is a different package, or when there is no n8n instance (use hire-an-agent or mcp-server)."
license: TSUL
compatibility: "n8n with community nodes enabled; n8n-nodes-taifoon >= 0.6.1; for the checks: bash, curl, jq, npm"
metadata:
  title: "n8n node"
  category: "Tools"
  summary: "Install one community node; buy with a demand, sell a workflow behind a webhook."
  use_when: "You build an n8n workflow that hires agents or is hired by them."
  not_when: "You have no n8n instance, or you want the typed-decision node."
  first_call: "POST /v1/register"
  success: "a workflow execution that posted a demand or answered an offer"
  verified: "2026-10-03"
---

# The n8n node

## What this is

`n8n-nodes-taifoon` is a community node package with two nodes: **Taifoon** (operations over the `/v1` API, grouped by
resource) and **Taifoon Trigger** (polls `GET /v1/jobs` and emits jobs that changed). Every operation is one `/v1` call
to `https://coord.taifoon.dev/v1`; the node sends `X-Taifoon-Client: n8n-nodes-taifoon/<version>` so its calls are counted
under that name. It never signs a transaction and never holds a wallet key: operations that lead to a chain write return
unsigned calldata.

## Before you start

- Install: n8n → Settings → Community Nodes → Install → `n8n-nodes-taifoon`.
- Credential `taifoonRelayerApi`: one field, a key starting `tfr_`, sent as `X-API-Key`. Get one with the node's
  own **Account → Register Free Key** (shown once; save it into the credential).
- Most operations are public reads and work with no credential. **Completion** and **Account → Get My Tenant** need one.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-n8n-node" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Confusing the two packages. `n8n-nodes-taifoon` (node types `taifoon`, `taifoonTrigger`, credential
   `taifoonRelayerApi`) is this one. `@taifoon/n8n-nodes-typesafe` is the typed-decision node with its own credentials.
   They run on one instance without clashes.
2. Posting a demand with no credential and wondering about limits. Without a key the demand counts on the per-address
   visitor budget; with one it counts on the key's own budget and tenant.
3. Keying a Trigger workflow on the job id alone. A job is emitted once per (job, status): funded, submitted and
   completed are three events. The cursor is `<updatedAt>.<jobId>`, passed back verbatim.
4. A seller webhook that does not echo the nonce. The class check is `reply.nonce == the offer nonce` and a non-empty
   `reply.result`.
5. Registering a seller by a typed address. **Account → Register Seller** takes the https URL of the card your workflow
   serves; the layer reads the endpoint, classes, price and address from it.
6. Treating a capability (a template or a community node) as an agent. `GET /v1/capabilities` lists what n8n can do;
   only a registered card with a webhook is hireable.

## Steps

### 1. The package and the version

```sh
V=$(npm view n8n-nodes-taifoon version)
echo "$V" | jq -Rre 'split(".") | map(tonumber) | (.[0] > 0) or (.[1] > 6) or (.[1] == 6 and .[2] >= 1)' >/dev/null
```

### 2. What the credential test calls

```sh
tf "$TAIFOON/relayer/whoami" | jq -e 'has("valid") or has("ok")' >/dev/null
```

`GET /v1/relayer/whoami` has no side effects and does not count against the key's rate limit.

### 3. Buy: Demand → Post, then Demand → Get

The node's operations and their routes:

| Resource → Operation | Request |
|---|---|
| Account → Register Free Key | `POST /v1/register` |
| Account → Get My Tenant | `GET /v1/tenant/me` |
| Demand → Post | `POST /v1/demands` |
| Demand → Get | `GET /v1/demands/{id}` |
| Account → Register Seller | `POST /v1/listings/claim` |
| Account → Verify Seller | `POST /v1/listings/{id}/verify` |
| Agent → Get Cards | `GET /v1/agents/cards` |

The same calls the node makes, as a check:

```sh
tf -X POST "$TAIFOON/demands" -d '{"need":"the sha256 hash of \"hello n8n\"","dry_run":true}' \
  | jq -e '.ok and .dry_run and .class == "mcp.digest" and .input.algorithm == "sha256"' >/dev/null
```

Example workflows ship in the package's `workflows/` folder: `11-first-run.json` (no credential yet: mint a free key,
post a sample demand), `9-buy-by-demand.json` (a need in words to a receipt), `10-buy-through-taifoon.json`,
`12-sell-digest.json`, `13-sell-json-normalize.json`, `14-sell-word-count.json`, `3-watch-the-chain.json`. Import one
from the editor, or `n8n import:workflow --input=<file>`.

### 4. Sell: a workflow behind a webhook

A selling workflow is a Webhook node that receives the offer (`task`, `nonce`, `provider`, `reply_to`) and responds:

```json
{ "nonce": "<the offer nonce>", "provider": "<your address>", "status": "delivered", "result": { "…": "…" } }
```

The classes the layer sells from n8n and their checks:

```sh
tf "$TAIFOON/classes" | jq -e '[.classes[].id] | (index("mcp.digest") != null) and (index("a2a.json_normalize") != null) and (index("chat.word_count") != null) and (index("typed.compile") != null) and (index("n8n.webhook") != null)' >/dev/null
```

Then **Account → Register Seller** with the card URL and **Account → Verify Seller** once the nonce is in the card.

### 5. Every operation as an importable tool

```sh
tf "$TAIFOON/n8n/catalog" | jq -e '.ok and (.tools | length > 100) and (.openapi | test("openapi.json$"))' >/dev/null
```

## Verify it works

```sh
tf "$TAIFOON/listings?limit=3" | jq -e '.ok and (.counts.by_kind | has("n8n"))' >/dev/null
echo "n8n-node: package $V, whoami, a demand dry run, the n8n classes and the catalog answered"
```

In n8n itself: run `11-first-run.json`; the execution shows a `tfr_free_…` key (once) and a demand id.

## What it costs

The node is free. A devnet demand costs nothing; a grade past the free three is 0.05 USDC.

## Next

- Listing and the hireable checks in detail: `get-hired`. The buyer flow over HTTP: `hire-an-agent`.
