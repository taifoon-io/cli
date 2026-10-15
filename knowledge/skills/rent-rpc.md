---
name: rent-rpc
description: "Use Taifoon like any RPC: one JSON-RPC URL per chain, POST https://coord.taifoon.dev/gw/rpc/{chainId}, with a Taifoon key, for 12 EVM chains. The standard read set (eth_blockNumber, eth_getBlockByNumber/Hash, eth_getTransactionByHash, eth_getTransactionReceipt, eth_getLogs up to 10,000 blocks, eth_call, eth_getBalance, eth_getCode, eth_getTransactionCount, gas and fee reads, eth_chainId, net_version) goes to the chain's measured rotation with failover, and taifoon_getProof returns the proof that a transaction's or a block's block is inside the Taifoon superroot. Use when a stock client (viem, ethers, curl) or an agent needs reads on Base, Ethereum, Arbitrum One, Optimism, Polygon, BSC, Avalanche, Celo, Arc, Robinhood Chain or the Taifoon chains without choosing endpoints, and wants proofs on request. Do NOT use to send transactions (writes are refused), or for paged logs and account scans with decoded events (use explore-chain)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev; a Taifoon key (POST /v1/register) for 1,000 free requests a day"
metadata:
  title: "Use it like any RPC"
  category: "Tools"
  summary: "One JSON-RPC URL per chain, the standard reads, failover built in, and proofs on request."
  use_when: "You need chain reads on several EVM chains from a stock client, with proofs when you ask."
  not_when: "You need to send a transaction, or paged logs and account scans."
  first_call: "POST /gw/rpc/{chainId}"
  success: "a block, a receipt and a contract call answered through the gateway on two chains, and taifoon_getProof verified"
  verified: "2026-10-04"
---

# Use Taifoon like any RPC

## What this is

`POST https://coord.taifoon.dev/gw/rpc/{chainId}` is a JSON-RPC 2.0 endpoint, the same on every chain. Point a stock client
at it instead of a public endpoint. Each request goes to the first healthy endpoint of that chain's rotation, which is
measured every 5 and 10 minutes. A 429, a 5xx or a timeout moves the request to the next endpoint, up to three, 15 s each.

| | |
|---|---|
| Methods | `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockReceipts`, `eth_getLogs` (at most 10,000 blocks), `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, `eth_getStorageAt`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_chainId`, `net_version` |
| Proofs | `taifoon_getProof` with `[{"tx":"0x…"}]` or `[{"block":n}]`: the block's proof under the superroot, from the layer's indexes |
| Writes | refused with a JSON-RPC error |
| Batch | up to 20 calls in one request; a batch is one request |
| Free | 1,000 requests a UTC day per key (100 without a key), `/gw/rpc` and `/gw/mcp` together |
| Past it | 0.1 GRID (0.001 USDC) a request from the key's balance (`buy-access`) |

`GET /v1/access` is the price list, and `GET /v1/rpc` is the live health of every chain.

## Before you start

- A key: `POST https://coord.taifoon.dev/v1/register` (no body) answers `api_key` once. Keep it.
- Send it as `X-API-Key`. A key limited by scopes needs the `rpc` scope.

```sh
export TAIFOON=https://coord.taifoon.dev
H=(-H "X-Taifoon-Client: taifoon-skill-rent-rpc" -H "content-type: application/json")
[ -n "${TAIFOON_API_KEY:-}" ] && H+=(-H "X-API-Key: $TAIFOON_API_KEY")
rpc() { curl -sS -m 60 -X POST "$TAIFOON/gw/rpc/$1" "${H[@]}" -d "$2"; }
```

## Pitfalls

1. Sending a transaction. `eth_sendRawTransaction` and every signing method are refused. Send writes through your own
   wallet's RPC.
2. Debug and trace methods (`debug_*`, `trace_*`, `txpool_*`). They are not served (JSON-RPC error -32601). For decoded
   transactions and account scans use `explore-chain`.
3. An open `eth_getLogs` range. `fromBlock` must lie within 10,000 blocks of `toBlock`, so page wider scans.
4. Treating a refused method as an outage. A refused call is a JSON-RPC error at HTTP 200, as nodes answer. HTTP 502
   means no endpoint of the rotation answered.
5. Reading the price from memory. `x-taifoon-fee` and `x-taifoon-allowance` on each answer say what the call cost and how
   many free requests are used today. A 402 carries `next_step` with the top-up.
6. Using a chain id the gateway does not serve. That is a 404 naming the served list, the same as `GET /v1/rpc`.

## Steps

### 1. The served chains and their health

```sh
curl -sS -m 60 "$TAIFOON/v1/rpc" "${H[@]}" | jq -e '(.chains | length) >= 10 and ([.chains[].chain] | index(8453) != null) and ([.chains[].chain] | index(1) != null)' >/dev/null
```

### 2. The same call on two chains

```sh
rpc 8453 '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -e '.result | test("^0x[0-9a-f]+$")' >/dev/null
rpc 42161 '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -e '.result == "0xa4b1"' >/dev/null
```

### 3. An eth_call and a small log window on Base

USDC on Base: `totalSupply()`, then the Transfer logs of one block.

```sh
rpc 8453 '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x18160ddd"},"latest"]}' \
  | jq -e '.result | test("^0x[0-9a-f]{64}$")' >/dev/null
HEAD=$(rpc 8453 '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r .result)
B=$(printf '0x%x' $(( HEAD - 20 )))
rpc 8453 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\",\"fromBlock\":\"$B\",\"toBlock\":\"$B\"}]}" \
  | jq -e '.result | type == "array"' >/dev/null
```

### 4. A write is refused, with the reason

```sh
rpc 8453 '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x00"]}' | jq -e '.error.code == -32003' >/dev/null
```

### 5. A block and a receipt, then their proof

`taifoon_getProof` is answered from the layer's indexes, not forwarded. Its `blocks[0].hash` is the leaf the superroot
commits, and it must equal the block hash the receipt names.

```sh
B=$(printf '0x%x' $(( HEAD - 100 )))
TXH=$(rpc 8453 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockByNumber\",\"params\":[\"$B\",false]}" | jq -r '.result.transactions[0]')
RC=$(rpc 8453 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$TXH\"]}")
echo "$RC" | jq -e '.result.status == "0x1" or .result.status == "0x0"' >/dev/null
rpc 8453 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"taifoon_getProof\",\"params\":[{\"tx\":\"$TXH\"}]}" \
  | jq -e --arg h "$(echo "$RC" | jq -r .result.blockHash)" '.result.verified and .result.blocks[0].hash == $h' >/dev/null
```

### 6. From a client library

The URL is the only change. viem:

```text
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
const client = createPublicClient({ chain: base, transport: http('https://coord.taifoon.dev/gw/rpc/8453', { fetchOptions: { headers: { 'X-API-Key': process.env.TAIFOON_API_KEY } } }) });
await client.getBlock({ blockTag: 'latest' }); await client.getTransactionReceipt({ hash }); await client.getLogs({ address, fromBlock, toBlock });
const proof = await client.request({ method: 'taifoon_getProof', params: [{ tx: hash }] });
```

ethers v6:

```text
const req = new ethers.FetchRequest('https://coord.taifoon.dev/gw/rpc/8453'); req.setHeader('X-API-Key', process.env.TAIFOON_API_KEY);
const provider = new ethers.JsonRpcProvider(req, 8453, { staticNetwork: true });
await provider.getBlock('latest'); await provider.getTransactionReceipt(hash); await provider.send('taifoon_getProof', [{ tx: hash }]);
```

## Verify it works

What a call cost, and how much of the free allowance is used:

```sh
curl -sS -m 60 -D - -o /dev/null -X POST "$TAIFOON/gw/rpc/8453" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
  | tr -d '\r' | grep -i '^x-taifoon-step:' >/dev/null
echo "rent-rpc: Base and Arbitrum One answered through one URL per chain, and a receipt's block proven"
```

## What it costs

1,000 requests a UTC day per key are free. Past that, each request is 0.1 GRID (0.001 USDC), from the key's balance.
`GET /v1/access` has the price list and the rates: 120 a minute for a free key, ten times that with a balance.

## Next

- Top up the key: `buy-access`.
- Paged logs, account scans and protocol transitions with proofs: `explore-chain`.
- Prove one log for the on-chain verifier: `prove-anything`.
- The same reads as an MCP tool: `taifoon_rpc` (`wrap-in-an-agent`).
