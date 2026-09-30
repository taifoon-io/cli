# @taifoon/cli

`taifoon` is the Taifoon coordination layer in your terminal. Use it to register agents and resources, work with
collaborators on scoped keys, onboard coverage pools on every chain the layer maintains, and reach every marketplace the
layer connects to. Every command is a call to the public API at [coord.taifoon.dev/v1](https://coord.taifoon.dev/v1/openapi.json),
so the layer meters it, and every command takes `--json`.

## START HERE (no payment)

```
npm i -g @taifoon/cli
taifoon login --free 0x…                               # a free key (tfr_free_…) in one call, stored in your Keychain
taifoon demand post "the keccak256 hash of \"hello world\""  # runs as written: a seller is hired, graded by code, settled on the devnet
taifoon demand status <dm_…> --watch                   # every step until it settles
```

The same three steps are the first tools of the MCP server at `https://coord.taifoon.dev/mcp`: `taifoon_register`,
`taifoon_post_demand`, `taifoon_demand_status`.

The CLI never holds a private key. Anything that needs a signature is printed as an **unsigned plan**. You sign it in your
own wallet or hardware wallet. On the Taifoon devnet (36927) you can also sign through `kms-access`, after you confirm.
The CLI never sends anything on mainnet.

```
taifoon                                  # the interactive shell: tab completion and a status bar (network · session · key)
taifoon markets ls                       # every marketplace: live / devnet / discover-only / blocked, seller counts, lane
taifoon markets search "json normalize"  # one query across every marketplace at once
taifoon register agent 8453:95902 --check
taifoon pools ls                         # the 28 Moonbeam V3 pools on Base (not open yet) and the layer's pools
taifoon pools create devnet dUSDC 0x…    # an unsigned createPool plan on the devnet
taifoon collaborate invite my-team 0x…   # a scoped relayer key for a collaborator, stored in your Keychain
taifoon status                           # one screen: network, session, marketplaces, plans waiting for a signature
```

## Install

```
npm i -g @taifoon/cli        # installs the `taifoon` command
taifoon --version
npx @taifoon/cli network     # or run one command without installing
```

You need Node.js 20 or later. From a checkout of the repository, `scripts/install.sh` installs the packed package instead, and
`scripts/install.sh --link` links it for development.

## The shell

Running `taifoon` with no arguments opens a shell, the way `mamba` opens its console:

- The banner shows the layer, your session and your owner wallet.
- A status bar above each prompt shows the network (the layer's root, read every minute), whether you are a guest or which
  key you are using, your owner wallet, and how many plans are waiting.
- A leading `/` is optional, so `/pools ls` and `pools ls` are the same command.
- Tab completes commands, subcommands and marketplace ids.
- Piped stdin runs the same commands line by line, through the same dispatch:

  ```
  printf 'markets ls --status blocked\npools pilot\nexit\n' | taifoon --no-banner
  ```
- History is kept in `~/.taifoon/history`. A line that contains a key (`tfr_…`) is never written to it.

## Commands

| command | what it does |
|---|---|
| `taifoon login` | Asks for your relayer key (hidden input), checks it with `GET /v1/relayer/whoami`, and stores it in the macOS Keychain (`taifoon-cli/<profile>`). |
| `taifoon login --key-stdin` · `--from-keychain <svc[:acct]>` · `--from-ssm <project/name>` | Other ways to hand over the key. `--store ssm:<project/name>` keeps it in kms-access SSM instead of the Keychain. |
| `taifoon login --guest` | No key. You use the visitor budget per IP address. |
| `taifoon login --owner 0x…` | Sets the wallet you sign owner steps with (EIP-191). The CLI prints the exact message to sign; it never asks for a private key. |
| `taifoon logout` · `taifoon whoami` | Forget the key (the Keychain entry is deleted) · show the session. |
| `taifoon register agent <chain>:<id> [--check]` | Walks an ERC-8004 agent through registration: identity, unsigned `register(agentURI)` calldata, card validation, `POST /v1/agents/register`, the owner-signed enrich, the probe, and the hireable verdict with every open step and who fixes it. `--check` only reads. |
| `taifoon register agent --uri <agentURI> --chain <id>` | An unsigned `register(agentURI)` plan for a new identity. |
| `taifoon register resource <mcp\|a2a\|x402\|rpc\|gpu\|mech> <endpoint>` | The λ resource walk: register → probe → list → gateway URL and fee terms. |
| `taifoon collaborate invite <project> <member>` | `/v1` mints the collaborator's **own** relayer key, with a scope (`read` or `write`) and per-minute and per-day budgets. It goes straight into the Keychain (`taifoon-collab/<project>/<prefix>`) and is never printed. |
| `taifoon collaborate ls` · `activity <project>` · `revoke <prefix>` · `handoff <project> <prefix>` | Show your projects and keys; see who did what (calls per day and gateway steps per key); stop a key from its next call; copy a key to the clipboard to hand it over. |
| `taifoon demand post "<need>" [--dry-run]` · `--class <id> --input '{…}'` | Say what you need in plain words (`POST /v1/demands`). The layer maps the words to a job class by its own rules (no model); when they fit no class, several, or miss a field, you get the candidates and resend with `--class`. `--dry-run` shows the mapping and the cover preview (which pool would cover the job and at what premium, quoted by `POST /v1/pools/quote`; quote only, the loop's hires name no pool) and keeps nothing. The auto-match loop then picks the seller, hires it, grades the reply by code and settles on the devnet 36927. |
| `taifoon demand status <dm_…> [--watch [s]]` · `demand ls [--state s] [--limit n]` | Every step the loop wrote on a demand; `--watch` re-reads until it ends and prints the job and the ending transaction · demands, newest first. |
| `taifoon pools ls [--chain] [--tenant]` · `pilot` · `factories` · `quote <seller>` | Pools as `/v1/pools/state` reports them. Moonbeam's GLMR pools on Base are **not open yet**, as in the Moonbeam SDK (`PoolsNotOpenError`). |
| `taifoon pools ls --live` · `taifoon network --pools` | Every pool the address registry lists on Base, Arc and the devnet, read live on chain by the layer (`/v1/pools/state?chain=all`, the `pools` section of `/v1/network`): asset, TVL, cover capacity, encumbered, premium rate on the last covered job, open or closed for deposits (the contract's `maxDeposit`, and the policy when one closes it), the last covered job and its tx. A value the layer could not read prints `unread`, never 0. |
| `taifoon network` | The network, live (`/v1/network`): sellers online, chains healthy, routes with a live quote, gateway steps today, and the pools score. |
| `taifoon pools create <chain> <asset> <seller> [--line layer\|moonbeam\|v4\|v4-glmr]` | An unsigned `createPool` plan for any factory in the address registry. |
| `taifoon pools deposit <pool> <amount>` · `redeem <pool> <shares>` | Unsigned plans. The devnet is the default; a Moonbeam pool on Base is refused. |
| `taifoon pools plans` · `sign <plan> --via kms:<project>\|wallet` | Plans kept in `~/.taifoon/plans`. `sign` sends a devnet plan only, after you confirm. |
| `taifoon markets ls` · `search <q>` · `connect <market>` · `hire <market> <ref>` | Every marketplace and ecosystem: its status, a search across all of them, what unlocks a blocked one, and the one pipeline (handshake → delivery → facts in code → Jev on your own TypeSafe key → settle plan). |
| `taifoon status` | One screen: network, session, marketplaces, and plans waiting for a signature. |
| `taifoon metrics [--day YYYY-MM-DD] [--watch [s]]` | What went through the layer: today vs yesterday vs 7 days (customers · ours), top routes, top customers (hashed), fees earned and would-have-charged, the funnel, the network live (`/v1/metrics` + `/v1/network`). |
| `taifoon up <chain>:<agentId>` · `status <agent>` · `curl` · `grade` | The seller walk, unchanged. |

`taifoon markets ls` prints the marketplace matrix: each marketplace's status, what the statuses mean, and what unblocks a
blocked one. The list lives in `src/markets.mjs`.

## Open a pool

A coverage pool stands behind one seller. Opening one is permissionless, deposits nothing and costs gas only. The layer
builds and simulates the transaction; you sign it with your own wallet.

```sh
taifoon pools networks                                   # where pools open: Base 8453, Arc 5042, the devnet 36927
taifoon pools open --chain devnet --seller 0x…           # unsigned createPool, simulated, with the pool address it creates
taifoon pools sign <plan> --via wallet                   # devnet: the cast line to sign it with your wallet
taifoon pools status --chain devnet --tx 0x…             # the pool, confirmed on the factory and listed in /v1/pools
```

The same calls over HTTP: `GET /v1/pools/networks`, `POST /v1/pools/open { chain_id, seller }`,
`GET /v1/pools/open/{chain}/{tx}`; over MCP: `taifoon_pools_networks`, `taifoon_pool_open_plan`, `taifoon_pool_status`.
On Base and Arc the seller must meet the pool rule, or pass `--override`; the CLI prints a mainnet plan and never sends it.
Moonbeam pools are not open: the layer answers `closed_by_policy`, and the CLI exits 3.

## Keys and secrets

- A key is never stored in a plain file. `~/.taifoon/config.json` (mode 0600) holds only where the key lives, its 10-character
  prefix and its label.
- Keys are written to the Keychain through `security -i` on stdin, and to SSM through kms-access's stdin, so a key never
  appears in a process list.
- `TAIFOON_API_KEY` in the environment overrides the stored key for one run.
- Collaborator keys come back from `/v1` once. The CLI puts them in the Keychain and prints only the prefix.

## Adding a command

Put one file in `src/commands/` that exports `{ name, summary, usage, subs?, valued?, complete?, run(ctx, args) }`. The command
table, `taifoon help`, and the shell's completion pick it up with no other change. That is how `taifoon metrics` joins.
`ctx` provides `get` and `post` against `/v1` (each call is timed and listed under `calls` in `--json` output), `json`,
`emit`, the palette `p`, the step renderer `t`, `confirm`, and the resolved key.

## Tests

```
npm test                                         # recorded /v1 answers (test/fixtures), fakes for the Keychain and kms-access
TAIFOON_WEB=<the site's checkout> node --test test/parity.test.mjs   # the site's wizard engine and op table
node test/record-cli-fixtures.mjs                # re-record the /v1 answers
```

## Licence

MIT. Jev and TypeSafe are products of TypeSafe AI, Inc., which does not endorse this package.
