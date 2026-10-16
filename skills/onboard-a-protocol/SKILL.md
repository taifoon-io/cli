---
name: onboard-a-protocol
description: "Onboard a protocol to the Taifoon coordination layer with a manifest: its contracts per chain, its events with topic0, and (v2) the order machine: key, states, transitions with bind paths and guards, actions, ABI and finality type. POST /v1/protocols/register checks everything and, with dry_run, keeps nothing. Use when the task is to make a bridge, intent, aggregator, DEX or AMM protocol's orders decodable and attributable on the layer, or to write or fix such a manifest. Do NOT use for a single transitions file, schema or decoder table on its own (use contribute-definitions) or to register an agent (use get-hired)."
license: TSUL
compatibility: "bash, curl, jq; Taifoon coordination API v1 at https://coord.taifoon.dev/v1"
metadata:
  title: "Onboard a protocol"
  category: "Contribute"
  summary: "One manifest: contracts, events, and the order machine. The API checks it before anything is kept."
  use_when: "You make a protocol's orders decodable on the layer, or fix its manifest."
  not_when: "You contribute one definition file, or register an agent."
  first_call: "POST /v1/protocols/register"
  success: "a manifest that passes the dry run"
  verified: "2026-10-03"
---

# Onboard a protocol

## What this is

A manifest tells the layer how to read a protocol: which contracts on which chains, which event opens an order and which
fills it, and, in version 2, the machine: the order key, the states, each transition (trigger event, bind paths resolved
against the ABI, guards, join role, proof), actions as unsigned-call templates, and the finality type. Every check the
manifest allows is made at intake; 422 lists every problem. A manifest that passes is queued as `submitted` for approval.
The answer's `does` says what is proven, attributed and decoded for it today, and what is not.

## Before you start

- Base URL: `https://coord.taifoon.dev/v1`. No key needed for a dry run.
- You need: contract addresses per chain id, the canonical event signatures, and the ABI of those events.
- `topic0` is keccak256 of the canonical signature. A wrong one is refused with the right value in the message.

```sh
export TAIFOON=https://coord.taifoon.dev/v1
tf() { curl -sS -m 90 -H "X-Taifoon-Client: taifoon-skill-onboard-a-protocol" -H "content-type: application/json" ${TAIFOON_API_KEY:+-H "X-API-Key: $TAIFOON_API_KEY"} "$@"; }
```

## Pitfalls

1. Submitting before a dry run. `"dry_run": true` checks and keeps nothing. Without it a passing manifest is queued.
2. `id` not snake_case. A letter, then 2 to 40 of `a-z 0-9 _`.
3. A `source_topic` that is not the `topic0` of one of `events`.
4. `identity: "mechanism"` for a shared event. When other protocols emit the same topic, use `"deployment"`: only your
   registered addresses count.
5. A key without the chain. `key` must contain the chain: `"{id}:{src_chain}:{guid}"` with `src_chain` bound to `$chain`.
6. A transition that moves an order without `join`. Only the opening transition (`from: null`) has none; every other names
   the role it finds the order by.
7. Re-sending a changed manifest under the same id and version: 409 `version_conflict`. Bump `v2.version`.
8. Reading registration as proof coverage. Any transaction on a chain the layer reads over RPC is provable, registered or
   not; `does.proofs` says how many of your chains that covers.

## Steps

### 1. What is decoded today, and the shape

```sh
tf "$TAIFOON/protocols/decoders" | jq -e '.ok and (.decoded | length > 0) and (.register.path == "/v1/protocols/register") and (.chains.per_transaction > 0)' >/dev/null
```

### 2. Write the manifest

A complete v2 manifest for a two-event order protocol (replace the contract with your own):

```sh
cat > /tmp/taifoon-manifest.json <<'JSON'
{ "dry_run": true,
  "id": "skill_demo_orders", "name": "Skill demo orders", "type": "intent",
  "contracts": { "8453": ["0x000000000000000000000000000000000000dEaD"] },
  "source_topic": "0x9ff48ec82167a0517e3606169155695cae17c29cbebaf9860e0637032d243091",
  "fill_topic": "0x0555709e59fb225fcf12cc582a9e5f7fd8eea54c91f3dc500ab9d8c37c507770",
  "events": [
    { "name": "OrderPlaced", "signature": "OrderPlaced(bytes32,address,uint256)",
      "topic0": "0x9ff48ec82167a0517e3606169155695cae17c29cbebaf9860e0637032d243091", "role": "deposit", "indexed": 2 },
    { "name": "OrderFilled", "signature": "OrderFilled(bytes32,address)",
      "topic0": "0x0555709e59fb225fcf12cc582a9e5f7fd8eea54c91f3dc500ab9d8c37c507770", "role": "fill", "indexed": 2 } ],
  "identity": "deployment", "supported_dst": [8453], "docs": "https://example.org/docs",
  "v2": {
    "version": 1,
    "key": "{id}:{src_chain}:{guid}",
    "states": ["Placed", "Filled"],
    "transitions": [
      { "name": "place", "from": null, "to": "Placed",
        "trigger": { "event": "OrderPlaced(bytes32,address,uint256)", "side": "source", "contracts": "registered" },
        "bind": { "guid": "topics[1]", "src_chain": "$chain", "maker": "topics[2]", "amount": "args.amount" },
        "guards": ["args.amount > 0"], "proof": "receipt" },
      { "name": "fill", "from": "Placed", "to": "Filled",
        "trigger": { "event": "OrderFilled(bytes32,address)", "side": "fill", "contracts": "registered" },
        "bind": { "guid": "topics[1]", "filler": "topics[2]" }, "join": "guid", "proof": "receipt" } ],
    "actions": [],
    "abi": [
      { "type": "event", "name": "OrderPlaced", "inputs": [
        { "name": "guid", "type": "bytes32", "indexed": true }, { "name": "maker", "type": "address", "indexed": true },
        { "name": "amount", "type": "uint256", "indexed": false } ] },
      { "type": "event", "name": "OrderFilled", "inputs": [
        { "name": "guid", "type": "bytes32", "indexed": true }, { "name": "filler", "type": "address", "indexed": true } ] } ],
    "finality": "OP_DISPUTE_GAME",
    "author": "0x000000000000000000000000000000000000dEaD" } }
JSON
```

Bind paths: `topics[N]`, `args.<name>`, `args[N]`, `$chain`, `$emitter`, `$tx`, `$block`, `$ts`, `$log_index`,
`keccak(<path>)`, `lookup(<table>, <path>)`, `sibling(<signature>).<path>`. Finality is one of the V5 types, among them
`ETH_POS_CHECKPOINT`, `L2_OUTPUT_ROOT`, `OP_DISPUTE_GAME`, `ARB_BOLD`, `ZK_ROLLUP`, `INSTANT`, `DEPTH_BASED`.

### 3. Dry run it

```sh
tf -X POST "$TAIFOON/protocols/register" -d @/tmp/taifoon-manifest.json \
  | jq -e '.ok and .kept == "dry_run" and .id == "skill_demo_orders" and (.hash | test("^0x[0-9a-f]{64}$")) and (.does.proofs | type == "object") and (.fragments | type == "object")' >/dev/null
```

`hash` is keccak256 of the canonical JSON. `fragments` are the three pieces the producer's registries take. `does` says
what is available for it today.

### 4. See a refusal name the fix

```sh
jq '.events[0].topic0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' /tmp/taifoon-manifest.json \
  | tf -X POST "$TAIFOON/protocols/register" -d @- \
  | jq -e '.ok == false and (.problems | map(test("is not keccak256 of OrderPlaced")) | any)' >/dev/null
```

### 5. Submit, then watch the queue

Remove `"dry_run": true` and send it again: 201, state `submitted`. The queue is public:

```sh
tf "$TAIFOON/protocols/pending" | jq -e '.ok and (.counts | has("submitted") and has("approved") and has("rejected"))' >/dev/null
```

The same manifest can also be kept as a contribution of kind `manifest` signed by its author
(`contribute-definitions`), which is what the GRID earning rules read.

## Verify it works

```sh
tf "$TAIFOON/protocols" | jq -e 'type == "array" and length > 0' >/dev/null
echo "onboard-a-protocol: the decoder list, a passing dry run, a named refusal and the queue answered"
```

## What it costs

Nothing. `"grade": true` also grades the manifest and spends one of your grades.

## Next

- Earning by use (`onboard-protocol`: 1 point per counted job on a live protocol): `earn-grid`.
- Proofs for your protocol's transactions: `prove-a-transaction`.
