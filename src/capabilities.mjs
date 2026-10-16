// THE capability table (_CAPABILITIES_v1_): one row per verb of the `taifoon` CLI. It drives both doors:
//   the CLI     every usage line of every command starts with exactly one row's `cli` (the longest one that fits); a row whose
//               top-level verb has no hand-written command is served by the generic runner (commands/index.mjs) from its `http`
//   the MCP     `taifoon mcp` (src/mcp.mjs) serves one tool per row that has an `mcp` name, and no other tool
// test/capabilities.alignment.test.mjs fails when the CLI, the MCP server and this table drift.
//
// kind      read     a /v1 read (or the vendored address registry): a CLI verb AND an MCP tool
//           plan     a /v1 call that answers an UNSIGNED plan or a quote, never a signature: a CLI verb AND an MCP tool
//           handoff  no HTTP, no process: checks an unsigned plan and returns the kms-access command a human runs with an MFA
//                    session: a CLI verb AND an MCP tool
//           act      signs, sends, spends, or mints / revokes a key: CLI ONLY, never an MCP tool. `via` names the door the CLI
//                    takes: kms-access (a KMS signature, MFA) or keychain (your own relayer key, read from the Keychain or
//                    kms-access SSM, never printed)
//           local    computed on the client (the Keychain, saved plans, the registry, several reads folded into one screen):
//                    CLI only; `why` says why it is not one /v1 op
// key       the call needs your relayer key (x-api-key): the CLI reads it from the Keychain / kms-access SSM, the MCP server from
//           TAIFOON_API_KEY in its own environment. A read with `key: false` is sent with no key at all.
// http      { method, path } with :params from the arguments in order; `query` are optional query arguments, `body` the POST
//           body's fields. `run` instead of `http` names a function of src/facts.mjs or src/prove.mjs (both doors call it).

export const KINDS = Object.freeze(['read', 'plan', 'handoff', 'act', 'local']);
export const BOTH = Object.freeze(['read', 'plan', 'handoff']);
export const CLI_ONLY = Object.freeze(['act', 'local']);

const r = (o) => Object.freeze({ key: false, ...o });

export const CAPABILITIES = Object.freeze([
  // ── facts and proofs ──────────────────────────────────────────────────────────────────────────────────────────────────────
  r({ id: 'facts.chain', kind: 'read', cli: 'facts chain', mcp: 'facts_chain', op: 'the address registry + GET /v1/root/chains', run: 'factsChain', args: ['chain?'],
    summary: 'a chain by id, name or alias: its registry entry, our contracts on it, and its leaf in the superroot (live)' }),
  r({ id: 'facts.contracts', kind: 'read', cli: 'facts contracts', mcp: 'facts_contracts', op: 'the address registry', run: 'factsContracts', args: ['chain?'], query: ['system', 'kind', 'status'],
    summary: 'our contracts (and the third-party ones we read) by chain, system, kind; the same-address set across chains' }),
  r({ id: 'facts.superroot', kind: 'read', cli: 'facts superroot', mcp: 'facts_superroot', op: 'GET /v1/root + GET /v1/root/latest', run: 'factsSuperroot',
    summary: 'the superroot now: root, chains included, leaf count, the age of the layer’s published root, and what a proof against it is checked by' }),
  r({ id: 'prove.tx', kind: 'read', cli: 'prove tx', mcp: 'prove_tx', op: 'GET /v1/proof/tx/:chain/:tx', run: 'proveTx', args: ['chain', 'tx'],
    summary: 'the proof of one transaction: proven (with its v5 reference), held awaiting_proof, failed (reverted), or unproven' }),
  r({ id: 'prove.sale', kind: 'read', cli: 'prove sale', mcp: 'prove_sale', op: 'the sale run summary + GET /v1/proof/tx/:chain/:tx', run: 'proveSale', args: ['sale_key'], query: ['summary'],
    summary: 'the proofs a sale claims: every settled and paid step that names a transaction, each checked again through coord' }),
  r({ id: 'blocks.get', kind: 'read', cli: 'blocks get', mcp: 'blocks_get', op: 'GET /v1/chain/:chain/block/:id', http: { method: 'GET', path: '/v1/chain/:chain/block/:id' },
    summary: 'one block as the proof plane holds it (latest | finalized | a number | a hash), with its proof' }),
  r({ id: 'blocks.proof', kind: 'read', cli: 'blocks proof', mcp: 'blocks_proof', op: 'GET /v1/root/proof/:chain/:block', http: { method: 'GET', path: '/v1/root/proof/:chain/:block' },
    summary: 'the sibling path from one block to the superroot' }),

  // ── agents, jobs, venues, the network ─────────────────────────────────────────────────────────────────────────────────────
  r({ id: 'agents.search', kind: 'read', cli: 'agents search', mcp: 'agents_search', op: 'GET /v1/agents/hireable', http: { method: 'GET', path: '/v1/agents/hireable', query: ['q', 'chain', 'skill', 'class', 'protocol', 'verdict', 'limit', 'offset'] },
    summary: 'the hireable sellers, filtered by words, chain, skill, class, protocol' }),
  r({ id: 'agents.readiness', kind: 'read', cli: 'agents readiness', mcp: 'agents_readiness', op: 'GET /v1/agents/:chain/:id/readiness', http: { method: 'GET', path: '/v1/agents/:chain/:id/readiness' },
    summary: 'one ERC-8004 agent: the readiness steps, the next one' }),
  r({ id: 'agents.probe', kind: 'read', cli: 'probe', mcp: 'agents_probe', op: 'POST /v1/agents/probe', http: { method: 'POST', path: '/v1/agents/probe', body: ['url', 'chain', 'agent_id'] },
    summary: 'talk to an outside agent now (MCP, A2A, x402): does it answer, with which tools; nothing paid' }),
  r({ id: 'jobs.get', kind: 'read', cli: 'jobs get', mcp: 'jobs_get', op: 'GET /v1/jobs', http: { method: 'GET', path: '/v1/jobs', query: ['ids'] },
    summary: 'up to 50 jobs by id, comma separated' }),
  r({ id: 'jobs.trail', kind: 'read', cli: 'jobs trail', mcp: 'jobs_trail', op: 'GET /v1/hire/lifecycle/:id', http: { method: 'GET', path: '/v1/hire/lifecycle/:id' },
    summary: 'the lifecycle of one hire' }),
  r({ id: 'catalog.list', kind: 'read', cli: 'catalog', mcp: 'catalog_list', op: 'GET /v1/catalog', http: { method: 'GET', path: '/v1/catalog', query: ['status', 'class', 'protocol', 'q', 'limit', 'offset'] },
    summary: 'every hireable agent the layer resells: seller price + our fee, cover, the buy call' }),
  r({ id: 'catalog.get', kind: 'read', cli: 'catalog <cat_…>', mcp: 'catalog_get', op: 'GET /v1/catalog/:id', http: { method: 'GET', path: '/v1/catalog/:id' },
    summary: 'one catalog entry' }),
  r({ id: 'catalog.buy', kind: 'act', via: 'keychain', key: true, cli: 'catalog --buy', mcp: null, op: 'POST /v1/demands { catalog_id }',
    summary: 'buy from a catalog entry: the loop hires that seller, grades by code and settles' }),
  r({ id: 'demand.post', kind: 'act', via: 'keychain', key: true, cli: 'demand post', mcp: null, op: 'POST /v1/demands',
    summary: 'say what you need: the layer hires, grades and settles it (devnet)' }),
  r({ id: 'demand.status', kind: 'read', cli: 'demand status', mcp: 'demand_status', op: 'GET /v1/demands/:id', http: { method: 'GET', path: '/v1/demands/:id' },
    summary: 'every step the auto-match loop wrote for one demand' }),
  r({ id: 'demand.ls', kind: 'read', cli: 'demand ls', mcp: 'demand_ls', op: 'GET /v1/demands', http: { method: 'GET', path: '/v1/demands', query: ['state', 'limit'] },
    summary: 'demands, newest first' }),
  r({ id: 'venues.list', kind: 'read', cli: 'venues', mcp: 'venues_list', op: 'GET /v1/venues', http: { method: 'GET', path: '/v1/venues', query: ['view'] },
    summary: 'every venue the harvesters read: 7-day volume, buyers, failure rate, our offers (?view=targets)' }),
  r({ id: 'network', kind: 'read', cli: 'network', mcp: 'network', op: 'GET /v1/network', http: { method: 'GET', path: '/v1/network' },
    summary: 'sellers online, chains healthy, routes, gateway steps today, every registry pool' }),
  r({ id: 'metrics', kind: 'read', cli: 'metrics', mcp: 'metrics', op: 'GET /v1/metrics', http: { method: 'GET', path: '/v1/metrics', query: ['day'] },
    summary: 'what went through the layer: today vs yesterday vs 7 days' }),
  r({ id: 'phases', kind: 'read', cli: 'phases', mcp: 'landscape_phases', op: 'GET /v1/landscape/phases', http: { method: 'GET', path: '/v1/landscape/phases', query: ['phase', 'venue'] },
    summary: 'the phases of the agreement as live metrics' }),
  r({ id: 'phases.fixture', kind: 'local', cli: 'phases --fixture', mcp: null, op: 'none', why: 'folds pinned reads from a local directory' }),
  r({ id: 'path.board', kind: 'read', cli: 'path', mcp: 'path_board', op: 'GET /v1/listings?view=path', http: { method: 'GET', path: '/v1/listings', query: ['view', 'limit'] },
    summary: 'where sellers stand on the standard path (?view=path)' }),
  r({ id: 'path.listing', kind: 'local', cli: 'path <ls_…>', mcp: null, op: 'GET /v1/listings?view=path', why: 'picks one listing out of the board on the client; MCP: path_board' }),
  r({ id: 'path.agent', kind: 'read', cli: 'path <chain>:<agentId>', mcp: 'path_agent', op: 'GET /v1/agents/:chain/:id/readiness', http: { method: 'GET', path: '/v1/agents/:chain/:id/readiness' },
    summary: 'one ERC-8004 agent on the path: readiness steps and its TEE rail' }),
  r({ id: 'partners.lane', kind: 'read', cli: 'partners', mcp: 'partners_lane', op: 'GET /v1/partners', http: { method: 'GET', path: '/v1/partners' },
    summary: 'the partner-bond lane on the devnet: contracts, asset, states' }),
  r({ id: 'partners.ns', kind: 'read', cli: 'partners <ns>', mcp: 'partners_namespace', op: 'GET /v1/partners/:ns', http: { method: 'GET', path: '/v1/partners/:ns' },
    summary: 'one namespace, live: owner, bond, caps' }),
  r({ id: 'partners.member', kind: 'read', cli: 'partners <ns> <member>', mcp: 'partners_member', op: 'GET /v1/partners/:ns/members/:member', http: { method: 'GET', path: '/v1/partners/:ns/members/:member' },
    summary: 'one member, live: cap, reserved, headroom' }),
  r({ id: 'partners.plan', kind: 'plan', cli: 'partners plan', mcp: 'partners_plan', op: 'POST /v1/partners/plan', http: { method: 'POST', path: '/v1/partners/plan', body: ['action', 'chain_id', 'ns', 'amount', 'member', 'payout', 'cap', 'partner', 'seller', 'buyer', 'price', 'deposit', 'premium', 'deadline', 'pool', 'cover_cap', 'evaluator', 'evaluator_fee', 'review_window', 'dispute_window', 'challenge_window', 'salt', 'job_id', 'evidence', 'from', 'payment_ref'] },
    summary: 'the unsigned calls of a partner-bond action' }),
  r({ id: 'deploy.member', kind: 'local', cli: 'deploy member-contract', mcp: null, op: 'none', why: 'deploys the member\'s own contract with the member\'s own wallet (Foundry on their machine); a plan, a fork rehearsal, then their send' }),
  r({ id: 'new', kind: 'local', cli: 'new', mcp: null, op: 'none', why: 'writes a starter directory on the caller\'s machine (a card\'s starter from the layer, or the coord app template)' }),
  r({ id: 'reach', kind: 'local', cli: 'reach', mcp: null, op: 'the published hireability worklist', why: 'reads a published worklist file, not a /v1 op' }),
  r({ id: 'markets.ls', kind: 'local', cli: 'markets ls', mcp: null, op: 'several discovery reads', why: 'one read per marketplace directory, folded on the client; MCP: venues_list' }),
  r({ id: 'markets.search', kind: 'local', cli: 'markets search', mcp: null, op: 'several search reads', why: 'one query fanned out to every searchable marketplace; MCP: agents_search' }),
  r({ id: 'markets.connect', kind: 'local', cli: 'markets connect', mcp: null, op: 'the marketplace table', why: 'what activates a marketplace, from the table this CLI carries' }),
  r({ id: 'markets.hire', kind: 'act', via: 'keychain', key: true, cli: 'markets hire', mcp: null, op: 'POST /v1/handshake → /v1/judge/compose → /v1/settle',
    summary: 'handshake, delivery, grade and a settle plan with a marketplace seller' }),

  // ── pools, cover, settlement plans ────────────────────────────────────────────────────────────────────────────────────────
  r({ id: 'pools.ls', kind: 'read', cli: 'pools ls', mcp: 'pools_list', op: 'GET /v1/pools/state', http: { method: 'GET', path: '/v1/pools/state', query: ['chain', 'tenant', 'ids'] },
    summary: 'every pool and its state (chain=all: every registry pool read live)' }),
  r({ id: 'pools.quote', kind: 'plan', cli: 'pools quote', mcp: 'pools_quote', op: 'POST /v1/pools/quote', http: { method: 'POST', path: '/v1/pools/quote', body: ['seller', 'chainId', 'price', 'price_usdc', 'tenant', 'class'] },
    summary: 'the terms one job would settle on (no transaction)' }),
  r({ id: 'pools.networks', kind: 'read', cli: 'pools networks', mcp: 'pools_networks', op: 'GET /v1/pools/networks', http: { method: 'GET', path: '/v1/pools/networks' },
    summary: 'where a pool opens: every supported chain and line' }),
  r({ id: 'pools.open', kind: 'plan', cli: 'pools open', mcp: 'pools_plan_open', op: 'POST /v1/pools/open', http: { method: 'POST', path: '/v1/pools/open', body: ['chain_id', 'seller', 'asset', 'line', 'from', 'name', 'symbol', 'override', 'tenant'] },
    summary: 'an UNSIGNED, simulated createPool plan' }),
  r({ id: 'pools.status', kind: 'read', cli: 'pools status', mcp: 'pools_status', op: 'GET /v1/pools/state', http: { method: 'GET', path: '/v1/pools/state', query: ['chain', 'ids'] },
    summary: 'confirm an opened pool on its factory and in the index' }),
  r({ id: 'pools.factories', kind: 'read', cli: 'pools factories', mcp: 'pools_factories', op: 'the address registry', run: 'poolFactories', args: ['chain?'],
    summary: 'every pool factory in the address registry' }),
  r({ id: 'pools.pilot', kind: 'local', cli: 'pools pilot', mcp: null, op: 'none', why: 'a fixed notice about the pilot pools' }),
  r({ id: 'pools.create', kind: 'local', cli: 'pools create', mcp: null, op: 'POST /v1/assurance/call', why: 'the unsigned plan is encoded on the client and kept in ~/.taifoon/plans; MCP: pools_plan_open' }),
  r({ id: 'pools.deposit', kind: 'local', cli: 'pools deposit', mcp: null, op: 'none', why: 'the unsigned approve + deposit is encoded on the client and kept in ~/.taifoon/plans' }),
  r({ id: 'pools.redeem', kind: 'local', cli: 'pools redeem', mcp: null, op: 'none', why: 'the unsigned redeem is encoded on the client and kept in ~/.taifoon/plans' }),
  r({ id: 'pools.plans', kind: 'local', cli: 'pools plans', mcp: null, op: 'none', why: 'the plans kept in ~/.taifoon/plans' }),
  r({ id: 'pools.sign', kind: 'act', via: 'kms-access', key: true, cli: 'pools sign', mcp: null, op: 'kms-access send (devnet only)',
    summary: 'send a DEVNET plan after your yes, through kms-access or your own wallet' }),
  r({ id: 'cover.quote', kind: 'plan', cli: 'cover quote', mcp: 'cover_quote', op: 'GET /v1/cover/quote', http: { method: 'GET', path: '/v1/cover/quote', query: ['venue', 'job', 'buyer', 'chain', 'cap', 'network', 'pay_to', 'amount', 'nonce', 'sla', 'mech', 'fee', 'data_hash'] },
    summary: 'a signed quote to cover a job bought elsewhere' }),
  r({ id: 'cover.buy', kind: 'plan', cli: 'cover buy', mcp: 'cover_buy', op: 'POST /v1/cover/buy', http: { method: 'POST', path: '/v1/cover/buy', body: ['network', 'quote', 'signatures', 'from'] },
    summary: 'the exact transactions to send from your wallet for a cover quote' }),
  r({ id: 'cover.policy', kind: 'read', cli: 'cover policy', mcp: 'cover_policy', op: 'GET /v1/cover/policy/:id', http: { method: 'GET', path: '/v1/cover/policy/:id', query: ['network'] },
    summary: 'one policy: status, claim window, its settle transaction' }),
  r({ id: 'cover.ls', kind: 'read', cli: 'cover ls', mcp: 'cover_list', op: 'GET /v1/cover/policies', http: { method: 'GET', path: '/v1/cover/policies', query: ['buyer', 'network'] },
    summary: 'a buyer’s policies' }),
  r({ id: 'settle.plan', kind: 'plan', key: true, cli: 'settle plan', mcp: 'settle_plan', op: 'POST /v1/settle', http: { method: 'POST', path: '/v1/settle', body: ['chain_id', 'job', 'action'] },
    summary: 'an unsigned openJob / postVerdict plan' }),
  r({ id: 'assurance.plan', kind: 'plan', key: true, cli: 'assurance plan', mcp: 'assurance_plan', op: 'POST /v1/assurance/plan', http: { method: 'POST', path: '/v1/assurance/plan', body: ['network', 'action', 'from', 'job'] },
    summary: 'an unsigned assurance market plan' }),
  r({ id: 'judge.compose', kind: 'plan', key: true, cli: 'judge compose', mcp: 'judge_compose', op: 'POST /v1/judge/compose', http: { method: 'POST', path: '/v1/judge/compose', body: ['subject'] },
    summary: 'compose a grade; a 402 is returned as it is, never paid from here' }),
  r({ id: 'act.handoff', kind: 'handoff', cli: 'act', mcp: 'act_handoff', op: 'none: returns the kms-access command', run: 'handoff', args: ['plan'], query: ['project'],
    summary: 'check an unsigned plan {to, data, value, chainId} and print the kms-access command a human runs with an MFA session; never signs' }),

  // ── your key and your account ─────────────────────────────────────────────────────────────────────────────────────────────
  r({ id: 'login', kind: 'local', cli: 'login', mcp: null, op: 'GET /v1/relayer/whoami', why: 'stores your relayer key in the Keychain or kms-access SSM' }),
  r({ id: 'login.free', kind: 'act', via: 'keychain', cli: 'login --free', mcp: null, op: 'POST /v1/register', summary: 'mint a free key and store it in the Keychain (never printed)' }),
  r({ id: 'logout', kind: 'local', cli: 'logout', mcp: null, op: 'none', why: 'deletes the Keychain entry' }),
  r({ id: 'whoami', kind: 'read', key: true, cli: 'whoami', mcp: 'relayer_whoami', op: 'GET /v1/relayer/whoami', http: { method: 'GET', path: '/v1/relayer/whoami' },
    summary: 'the session: key prefix, validity, owner' }),
  r({ id: 'balance', kind: 'read', key: true, cli: 'balance', mcp: 'key_balance', op: 'GET /v1/access/key', http: { method: 'GET', path: '/v1/access/key' },
    summary: 'what your key holds: balance, plan, days left, rate' }),
  r({ id: 'buy.quote', kind: 'plan', key: true, cli: 'buy', mcp: 'access_quote', op: 'GET /v1/access/quote', http: { method: 'GET', path: '/v1/access/quote', query: ['usdc', 'plan', 'chainId'] },
    summary: 'the quote for a balance or a monthly plan: the transfer to send from your wallet and the message it signs' }),
  r({ id: 'buy.plans', kind: 'read', cli: 'buy plans', mcp: 'access_plans', op: 'GET /v1/access/plan', http: { method: 'GET', path: '/v1/access/plan' },
    summary: 'the monthly plans, what each includes and where they are paid' }),
  r({ id: 'buy.claim', kind: 'act', via: 'keychain', key: true, cli: 'buy claim', mcp: null, op: 'POST /v1/access/claim', summary: 'credit a payment to your key' }),
  r({ id: 'collaborate.invite', kind: 'act', via: 'keychain', key: true, cli: 'collaborate invite', mcp: null, op: 'POST /v1/relayer/keys', summary: 'mint a scoped key for a collaborator' }),
  r({ id: 'collaborate.ls', kind: 'read', key: true, cli: 'collaborate ls', mcp: 'relayer_keys', op: 'GET /v1/relayer/keys', http: { method: 'GET', path: '/v1/relayer/keys' },
    summary: 'your projects and their keys, with today’s use' }),
  r({ id: 'collaborate.activity', kind: 'read', key: true, cli: 'collaborate activity', mcp: 'relayer_activity', op: 'GET /v1/relayer/activity', http: { method: 'GET', path: '/v1/relayer/activity', query: ['project'] },
    summary: 'who did what: calls per day and gateway steps' }),
  r({ id: 'collaborate.revoke', kind: 'act', via: 'keychain', key: true, cli: 'collaborate revoke', mcp: null, op: 'POST /v1/relayer/keys/revoke', summary: 'stop a key at its next call' }),
  r({ id: 'collaborate.handoff', kind: 'local', cli: 'collaborate handoff', mcp: null, op: 'none', why: 'puts a collaborator key on the clipboard' }),
  r({ id: 'register.agent', kind: 'act', via: 'keychain', key: true, cli: 'register agent', mcp: null, op: 'POST /v1/agents/register (+ enrich, probe)', summary: 'the onboarding walk of an ERC-8004 agent (--check reads only)' }),
  r({ id: 'register.agent.uri', kind: 'plan', cli: 'register agent --uri', mcp: 'agents_register_plan', op: 'POST /v1/assurance/call { register-8004 }', http: { method: 'POST', path: '/v1/assurance/call', body: ['chainId', 'action'] },
    summary: 'the UNSIGNED register(agentURI) for a new ERC-8004 identity' }),
  r({ id: 'register.resource', kind: 'act', via: 'keychain', key: true, cli: 'register resource', mcp: null, op: 'POST /v1/agents/probe + the gateway terms', summary: 'the resource walk (--check reads only)' }),
  // _ONBOARDING_FLOW_v1_: the onboarding entry by connector type — the same walk (coord docs/ONBOARDING-FLOW.md)
  r({ id: 'resource.add', kind: 'act', via: 'keychain', key: true, cli: 'resource add', mcp: null, op: 'POST /v1/agents/probe + the gateway terms', summary: 'add a resource by connector type (rpc-list, compute, agent:mcp, pay:x402 …): the same walk as register resource; collect, stream, workflow, contracts and vault point where they go' }),
  r({ id: 'demo.n8n', kind: 'local', cli: 'demo n8n', mcp: null, op: 'several reads', why: 'replays the last tested run of the n8n example phase by phase' }),
  r({ id: 'demo.n8n.live', kind: 'act', via: 'keychain', key: true, cli: 'demo n8n --live', mcp: null, op: 'POST /v1/demands', summary: 'run the n8n flow on a new demand with your key' }),

  // ── _ONE_PRODUCT_v1_: one key — its role, its energy in GRID, what it owns, its hosted resources, the protocols and the stream it
  //    reads, the connection debuggers, the knowledge this release ships with, the agent session, and the admin's operator verbs ────
  r({ id: 'role', kind: 'read', optKey: true, cli: 'role', mcp: 'access_role', op: 'GET /v1/access/role', http: { method: 'GET', path: '/v1/access/role', query: ['resource'] },
    summary: 'your role (admin, owner, delegate, member, viewer or public), its scopes and outlets, what your key is bound to, and what you may do on a resource' }),
  r({ id: 'usage', kind: 'read', measure: true, key: true, cli: 'usage', mcp: 'access_usage', op: 'GET /v1/access/usage', http: { method: 'GET', path: '/v1/access/usage', query: ['window', 'scope'] },
    summary: 'your energy in GRID: IN (reads, streams) and WRITE (sends) per key and per project, agent or workflow it is bound to; what serving it cost; your earnings and vault' }),
  r({ id: 'owners.ls', kind: 'read', cli: 'owners', mcp: 'owners_list', op: 'GET /v1/owners', http: { method: 'GET', path: '/v1/owners', query: ['kind', 'q'] },
    summary: 'who owns each protocol, chain, product and connector, and the seats their original owners can claim' }),
  r({ id: 'owners.get', kind: 'read', cli: 'owners get', mcp: 'owners_get', op: 'GET /v1/owners/:id', http: { method: 'GET', path: '/v1/owners/:id' },
    summary: 'one owner record: who holds it, its delegable seat, its claim state' }),
  r({ id: 'owners.claim', kind: 'act', via: 'keychain', key: true, cli: 'owners claim', mcp: null, op: 'POST /v1/owners/:id/claim',
    summary: 'claim the seat of something you own (your protocol, your chain) with a proof; held until it is reviewed' }),
  r({ id: 'resource.list', kind: 'read', key: true, cli: 'resource list', mcp: 'resource_list', op: 'GET /v1/hosting/resources', http: { method: 'GET', path: '/v1/hosting/resources' },
    summary: 'your hosted resources (cells and agents on Taifoon hosting): status, URL, usage; an admin sees all' }),
  r({ id: 'resource.logs', kind: 'read', key: true, cli: 'resource logs', mcp: 'resource_logs', op: 'GET /v1/hosting/resources/:id/logs', http: { method: 'GET', path: '/v1/hosting/resources/:id/logs', query: ['since', 'tail'] },
    summary: 'the recent logs of one of your resources (the layer checks your role on it and meters the read)' }),
  r({ id: 'resource.metrics', kind: 'read', measure: true, key: true, cli: 'resource metrics', mcp: 'resource_metrics', op: 'GET /v1/hosting/resources/:id/metrics', http: { method: 'GET', path: '/v1/hosting/resources/:id/metrics' },
    summary: 'cpu, memory, restarts and GRID usage of one of your resources' }),
  r({ id: 'resource.stream', kind: 'local', cli: 'resource stream', mcp: null, op: 'GET /v1/hosting/resources/:id/stream (SSE)', why: 'follows a live server-sent stream until you stop it' }),
  r({ id: 'resource.start', kind: 'act', via: 'keychain', key: true, manage: true, cli: 'resource start', mcp: null, op: 'POST /v1/hosting/resources/:id/start', summary: 'start one of your resources (held to its prepaid balance)' }),
  r({ id: 'resource.stop', kind: 'act', via: 'keychain', key: true, manage: true, cli: 'resource stop', mcp: null, op: 'POST /v1/hosting/resources/:id/stop', summary: 'stop one of your resources' }),
  r({ id: 'resource.restart', kind: 'act', via: 'keychain', key: true, manage: true, cli: 'resource restart', mcp: null, op: 'POST /v1/hosting/resources/:id/restart', summary: 'restart one of your resources (never a shell: the layer checks your role on it and meters the call)' }),
  r({ id: 'resource.redeploy', kind: 'act', via: 'keychain', key: true, manage: true, cli: 'resource redeploy', mcp: null, op: 'POST /v1/hosting/resources/:id/redeploy', summary: 'redeploy one of your resources from its current image' }),
  r({ id: 'protocols.ls', kind: 'read', cli: 'protocols', mcp: 'protocols_list', op: 'GET /v1/protocols', http: { method: 'GET', path: '/v1/protocols' },
    summary: 'every protocol the layer reads: its family, chains and contracts' }),
  r({ id: 'protocol.order', kind: 'read', cli: 'protocol order', mcp: 'protocol_order', op: 'GET /v1/protocol/:protocol/order/:key', http: { method: 'GET', path: '/v1/protocol/:protocol/order/:key' },
    summary: 'one order of a protocol (a LayerZero message by guid, an Across deposit, an ERC-8183 job): every stage with its proof' }),
  r({ id: 'protocol.stuck', kind: 'read', cli: 'protocol stuck', mcp: 'protocol_stuck', op: 'GET /v1/protocol/:protocol/stuck', http: { method: 'GET', path: '/v1/protocol/:protocol/stuck', query: ['src', 'dst', 'since', 'limit'] },
    summary: 'the orders of a protocol past their expected next stage, each with its reason' }),
  r({ id: 'protocol.paths', kind: 'read', cli: 'protocol paths', mcp: 'protocol_paths', op: 'GET /v1/protocol/:protocol/paths', http: { method: 'GET', path: '/v1/protocol/:protocol/paths', query: ['src', 'dst'] },
    summary: 'measured stage-to-stage times per chain pair' }),
  r({ id: 'protocol.quote', kind: 'read', cli: 'protocol quote', mcp: 'protocol_quote', op: 'GET /v1/protocol/:protocol/quote', http: { method: 'GET', path: '/v1/protocol/:protocol/quote', query: ['src', 'dst'] },
    summary: 'how long a delivery takes on a chain pair (median and p90 of measured orders)' }),
  r({ id: 'projects.ls', kind: 'read', cli: 'projects', mcp: 'projects_list', op: 'GET /v1/projects', http: { method: 'GET', path: '/v1/projects' },
    summary: 'the project boards: a project, its protocols, its orders as the standard steps, its webhook and lane' }),
  r({ id: 'projects.get', kind: 'read', cli: 'projects get', mcp: 'projects_get', op: 'GET /v1/projects/:id', http: { method: 'GET', path: '/v1/projects/:id', query: ['limit'] },
    summary: 'one project board: orders with their steps, stuck orders, measured paths, counts' }),
  r({ id: 'stream.stats', kind: 'read', cli: 'stream stats', mcp: 'pipe_stats', op: 'GET /v1/pipe/stats', http: { method: 'GET', path: '/v1/pipe/stats' },
    summary: 'the pipe now: envelopes by state and venue, acks, batches, dead and lost' }),
  r({ id: 'stream.status', kind: 'read', cli: 'stream status', mcp: 'pipe_status', op: 'GET /v1/pipe/status/:id', http: { method: 'GET', path: '/v1/pipe/status/:id' },
    summary: 'one envelope: its state, attempts, carrier, ack and history' }),
  r({ id: 'stream.subscribe', kind: 'local', cli: 'stream subscribe', mcp: null, op: 'GET /v1/pipe/stream (SSE)', why: 'follows a live server-sent stream until you stop it' }),
  r({ id: 'send', kind: 'local', key: true, cli: 'send', mcp: null, op: 'POST /v1/pipe/send', why: 'a write on your key: a canonical record of any type (the lambda catalogue, GET /v1/lambda/catalog) becomes a sendable envelope and goes into the stream; --dry prints the envelope and sends nothing', summary: 'send a record into the stream as an envelope of a kind (type → envelope, the lambda catalogue); --dry builds without sending' }),
  r({ id: 'debug.rpc', kind: 'read', cli: 'debug rpc', mcp: 'debug_rpc', op: 'GET /v1/rpc/:chain + GET /v1/root/chains', run: 'debugRpc', args: ['chain'],
    summary: 'is a chain reachable: the RPC rotation for it and its header collector’s freshness, as one verdict with findings' }),
  r({ id: 'debug.protocol', kind: 'read', cli: 'debug protocol', mcp: 'debug_protocol', op: 'GET /v1/protocol/:protocol/stuck + /paths', run: 'debugProtocol', args: ['protocol'],
    summary: 'is a protocol leaf healthy: how far its watcher lags, what is stuck and why' }),
  r({ id: 'debug.order', kind: 'read', cli: 'debug order', mcp: 'debug_order', op: 'GET /v1/protocol/:protocol/order/:key', run: 'debugOrder', args: ['protocol', 'key'],
    summary: 'why an order is where it is: its stages, its proof state, its stuck reason' }),
  r({ id: 'debug.envelope', kind: 'read', cli: 'debug envelope', mcp: 'debug_envelope', op: 'GET /v1/pipe/status/:id', run: 'debugEnvelope', args: ['id'],
    summary: 'why an envelope was or was not delivered and acked: state, attempts, reasons, deadline' }),
  r({ id: 'debug.project', kind: 'read', cli: 'debug project', mcp: 'debug_project', op: 'GET /v1/projects/:id', run: 'debugProject', args: ['id'],
    summary: 'is a project wired: its webhook, its lane, its open and stuck orders' }),
  r({ id: 'debug.resource', kind: 'read', key: true, cli: 'debug resource', mcp: 'debug_resource', op: 'GET /v1/hosting/resources (+ /metrics, /logs)', run: 'debugResource', args: ['id'],
    summary: 'why one of your hosted resources misbehaves: its status, metrics and the error lines of its recent logs' }),
  r({ id: 'docs.ls', kind: 'read', cli: 'docs', mcp: 'docs_list', op: 'the knowledge shipped with this release', run: 'knowledgeList',
    summary: 'what this release knows: the coord language, the studio blocks, the skills (and, for an admin, the operator skills)' }),
  r({ id: 'docs.search', kind: 'read', cli: 'docs search', mcp: 'docs_search', op: 'the knowledge shipped with this release', run: 'knowledgeSearch', args: ['query'], query: ['limit'],
    summary: 'search the knowledge by words; the best documents with their best lines' }),
  r({ id: 'docs.get', kind: 'read', cli: 'docs get', mcp: 'docs_get', op: 'the knowledge shipped with this release', run: 'knowledgeGet', args: ['topic'],
    summary: 'one document by its topic' }),
  r({ id: 'workflow.check', kind: 'read', cli: 'workflow check', mcp: 'workflow_check', op: 'the language’s workflow check', run: 'workflowCheck', args: ['steps'], query: ['grant', 'outlet', 'ends_at'],
    summary: 'check a studio workflow against the language: every step exists, steps connect, writes stay on outlets the grant holds' }),
  r({ id: 'studio', kind: 'local', cli: 'studio', mcp: null, op: 'the agent session', why: 'an LLM session whose tools are this table, filtered by your role; the same session as the online studio and cockpit' }),
  r({ id: 'ask', kind: 'local', cli: 'ask', mcp: null, op: 'one agent turn', why: 'one question to the agent: the answer and every tool call it made' }),
  r({ id: 'model', kind: 'local', cli: 'model', mcp: null, op: 'the agent’s model', why: 'shows or sets the model provider (your Anthropic key, or our metered lanes), kept in ~/.taifoon/config.json' }),
  r({ id: 'model.local', kind: 'local', cli: 'model local', mcp: null, op: 'open-mamba', why: 'runs mamba, the local agent runtime, when it is installed: up, status, logs, down' }),
  r({ id: 'admin', kind: 'local', role: 'admin', cli: 'admin', mcp: null, op: 'the coord operator CLI', why: 'the operator verbs of the coord CLI on this machine: admin only (an operator token and a coord checkout)' }),

  // ── the client itself (no command module: wired by main.mjs) ──────────────────────────────────────────────────────────────
  r({ id: 'status', kind: 'local', cli: 'status', mcp: null, op: 'GET /v1/root/latest + /v1/network + /v1/relayer/whoami', why: 'one screen folded from three reads and your session' }),
  r({ id: 'up', kind: 'local', cli: 'up', mcp: null, op: 'the seller walk', why: 'the seller walk, kept in ~/.taifoon/up' }),
  r({ id: 'curl', kind: 'local', cli: 'curl', mcp: null, op: 'none', why: 'prints the curls of the last walk step' }),
  r({ id: 'grade', kind: 'local', cli: 'grade', mcp: null, op: 'none', why: 'one job through the grader package with your own key' }),
  r({ id: 'mcp', kind: 'local', cli: 'mcp', mcp: null, op: 'none', why: 'the MCP server itself (stdio)' }),
  r({ id: 'help', kind: 'local', cli: 'help', mcp: null, op: 'none', why: 'this help' }),
]);

/** the verbs main.mjs wires itself (no module in commands/) */
export const WIRED_BY_MAIN = Object.freeze(['status', 'up', 'curl', 'grade', 'help']);

const tokens = (s) => String(s).trim().split(/\s+/);
/** the row a usage line belongs to: the longest `cli` that is a token prefix of the line; null when none */
export function rowOfUsage(line, rows = CAPABILITIES) {
  const t = tokens(line); let best = null;
  for (const row of rows) {
    const c = tokens(row.cli);
    if (c.length <= t.length && c.every((x, i) => x === t[i]) && (!best || c.length > tokens(best.cli).length)) best = row;
  }
  return best;
}
export const byId = (id) => CAPABILITIES.find((x) => x.id === id);
export const byMcp = (name) => CAPABILITIES.find((x) => x.mcp === name);
/** the :params of an http path, in order */
export const paramsOf = (path) => [...String(path).matchAll(/:([a-z_]+)/gi)].map((m) => m[1]);
/** the rows whose top-level verb no hand-written command serves: the generic runner serves them from `http` (or `run`) */
export const genericVerbs = (handWritten) => [...new Set(CAPABILITIES.map((x) => tokens(x.cli)[0]))].filter((v) => !handWritten.has(v) && !WIRED_BY_MAIN.includes(v));

/** the request a row makes for these arguments: { method, path (with query), body } or a reason it cannot */
export function requestOf(row, args = {}) {
  const h = row.http; if (!h) return { ok: false, why: `${row.id} has no http op` };
  let path = h.path;
  for (const p of paramsOf(h.path)) {
    const v = args[p]; if (v === undefined || v === null || v === '') return { ok: false, why: `${row.id} needs ${p}` };
    path = path.replace(`:${p}`, encodeURIComponent(String(v)));
  }
  const qs = (h.query ?? []).filter((k) => args[k] !== undefined && args[k] !== null && args[k] !== '').map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(args[k]))}`);
  if (qs.length) path += `${path.includes('?') ? '&' : '?'}${qs.join('&')}`;
  const body = h.method === 'POST' ? Object.fromEntries((h.body ?? []).filter((k) => args[k] !== undefined).map((k) => [k, args[k]])) : undefined;
  return { ok: true, method: h.method, path, body };
}

/** the JSON schema of a row's MCP arguments: path params required, query and body optional (strings, or any JSON for a body) */
export function inputSchemaOf(row) {
  const props = {}; const required = [];
  const add = (name, type, req, d) => { props[name] = { ...(type ? { type } : {}), description: d }; if (req) required.push(name); };
  if (row.http) {
    for (const p of paramsOf(row.http.path)) add(p, 'string', true, `the ${p} of ${row.http.path}`);
    for (const q of row.http.query ?? []) add(q, 'string', false, `query ${q}`);
    for (const b of row.http.body ?? []) add(b, null, false, `body field ${b}`);
  } else {
    for (const a of row.args ?? []) { const opt = a.endsWith('?'); const n = opt ? a.slice(0, -1) : a; add(n, n === 'plan' ? 'object' : 'string', !opt, n); }
    for (const q of row.query ?? []) add(q, 'string', false, q);
  }
  return { type: 'object', properties: props, required, additionalProperties: false };
}
