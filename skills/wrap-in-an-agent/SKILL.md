---
name: wrap-in-an-agent
description: "Give an agent one Taifoon key and the whole API: the MCP server at https://coord.taifoon.dev/mcp (taifoon_access, taifoon_rpc, taifoon_prove, taifoon_access_topup and the hiring tools), the n8n node n8n-nodes-taifoon, the CLI @taifoon/cli, or plain HTTP with X-API-Key; scope and cap the agent's key so it cannot spend more than it should, and read what it used. Use when building or configuring an agent (Claude, Cursor, an n8n workflow, a script) that should read chains, prove events or use the coordination API with its own key. Do NOT use to sell the agent's own work (use get-hired), or for the price list and top-up alone (use buy-access)."
license: TSUL
compatibility: "bash, curl, jq; an MCP client (Streamable HTTP) or n8n or Node.js >= 18 for the CLI; Taifoon coordination API v1 at https://coord.taifoon.dev"
metadata:
  title: "Wrap the API in an agent"
  category: "Tools"
  summary: "One key in the agent: MCP tools, n8n node or CLI, scoped and capped, its usage read back."
  use_when: "An agent you build should read chains, prove events or use the coordination API with its own key."
  not_when: "You are listing your agent for hire, or only need the price list."
  first_call: "POST /v1/register"
  success: "the MCP server lists the access tools and answers taifoon_rpc and taifoon_access with the key"
  verified: "2026-10-04"
---

# Wrap the API in an agent

## What this is

An agent holds one key. Every way in sends it as `X-API-Key` and is metered under it:

| Way in | Where | What the agent gets |
|---|---|---|
| MCP | `https://coord.taifoon.dev/mcp` (Streamable HTTP) | the tools below, plus hiring, grading and the tenant |
| n8n | community node `n8n-nodes-taifoon` | operations over `/v1`, the Taifoon Trigger |
| CLI | `npx @taifoon/cli` | every `/v1` call with `--json` |
| HTTP | `https://coord.taifoon.dev/v1` and `/gw/rpc/{chainId}` | everything in `GET /v1/openapi.json` |

The access tools:

| Tool | Does |
|---|---|
| `taifoon_access` | the price list (view `products`), the key's standing (`key`) and its usage per family (`usage`) |
| `taifoon_rpc` | one JSON-RPC read on any served chain |
| `taifoon_prove` | a proof by kind: `tx`, `log`, `order`, `transition`, `blocks`, `protocols` |
| `taifoon_access_topup` | the quote (`usdc`), then the credit (`tx` and `signature`); it never signs |
| `taifoon_chain_lookup` | a block, a transaction or a receipt, with its proof (`explore-chain`) |
| `taifoon_chain_logs`, `taifoon_account_scan`, `taifoon_scan_job` | logs and an account's events or transactions over a block window, with proofs |
| `taifoon_transitions` | a protocol's state transitions from the protocol trees |

## Before you start

- A key for the agent: `POST /v1/register` (no body), shown once. Give each agent its own key. For more keys with labels,
  scopes and caps, use `POST /v1/tenant/keys { action: "create" }` with any key of your tenant.

```sh
export MCP=https://coord.taifoon.dev/mcp
mcp() { curl -sS -m 90 -X POST "$MCP" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "X-Taifoon-Client: taifoon-skill-wrap-in-an-agent" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} -d "$1" | sed -n 's/^data: //p;/^{/p' | head -1; }
```

## Pitfalls

1. One key shared by every agent. Give each agent its own labelled key, so its usage, caps and revocation are its own.
2. An uncapped key in an agent you do not watch. Set `cap_day_grid` and `scopes` when you create it. Over the cap the agent
   gets 402 `budget` and spends nothing more.
3. Putting the key in the agent's prompt. Put it in the client's header config (`--header "X-API-Key: …"`) or the
   environment, never in text a model may echo.
4. Registering a new key every session. At most 3 are minted a day per caller address. Keep the one you have.
5. Expecting a tool to sign or pay. `taifoon_access_topup` returns the transfer to send and the message to sign; your wallet
   does both.
6. Reading the tool list from memory. `tools/list` is the live set.

## Steps

### 1. Add the server to a client, with the key as a header

```text
claude mcp add --transport http taifoon https://coord.taifoon.dev/mcp --header "X-API-Key: $TAIFOON_API_KEY"
```

```json
{ "mcpServers": { "taifoon": { "type": "http", "url": "https://coord.taifoon.dev/mcp", "headers": { "X-API-Key": "tfr_free_…" } } } }
```

### 2. The access tools are there

```sh
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"taifoon-skill-wrap-in-an-agent","version":"1"}}}' | jq -e '.result.serverInfo.name == "taifoon"' >/dev/null
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq -e '[.result.tools[].name] | (index("taifoon_access") != null) and (index("taifoon_rpc") != null) and (index("taifoon_prove") != null) and (index("taifoon_access_topup") != null)' >/dev/null
```

### 3. A chain read and a proof, as tools

```sh
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"taifoon_rpc","arguments":{"chain_id":8453,"method":"eth_blockNumber"}}}' | jq -e '.result.content[0].text | fromjson | .result | test("^0x[0-9a-f]+$")' >/dev/null
mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"taifoon_prove","arguments":{"kind":"protocols"}}}' | jq -e '.result.content[0].text | fromjson | (.protocols | length) > 0' >/dev/null
mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"taifoon_chain_lookup","arguments":{"kind":"block","chain_id":8453,"id":"finalized"}}}' | jq -e '.result.content[0].text | fromjson | .proof.verified' >/dev/null
```

### 4. The price list, and what the key used

```sh
mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"taifoon_access","arguments":{}}}' | jq -e '.result.content[0].text | fromjson | .schema == "taifoon.access.v1"' >/dev/null
if [ -n "${TAIFOON_API_KEY:-}" ]; then
  mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"taifoon_access","arguments":{"view":"usage","window":"1d"}}}' | jq -e '.result.content[0].text | fromjson | .ok and (.families | has("rpc"))' >/dev/null
fi
```

### 5. The same from the CLI and n8n

```text
npx @taifoon/cli login --free                    # a key, kept in the Keychain or shown once
npx @taifoon/cli whoami --json                   # the key, its prefix and validity
n8n: Settings → Community Nodes → n8n-nodes-taifoon; credential Taifoon API = the key
```

## Verify it works

```sh
curl -sS -m 60 "https://coord.taifoon.dev/v1/openapi.json" -H "X-Taifoon-Client: taifoon-skill-wrap-in-an-agent" | jq -e '.paths | has("/v1/access") and has("/v1/access/usage")' >/dev/null
echo "wrap-in-an-agent: the agent's tools answer a chain read, a proof list and the price list"
```

## What it costs

The tools cost what the calls they make cost (`GET /v1/access`). A free key covers 1,000 RPC requests a day and 90
budgeted calls a minute per family.

## Next

- Top up the agent's key: `buy-access`.
- Chain reads in depth: `rent-rpc`. Proofs: `prove-anything`.
- Let the agent hire others: `hire-an-agent`. Sell its own work: `get-hired`.
