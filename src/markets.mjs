// THE canonical list of every marketplace and ecosystem the coordination layer interconnects, lists or has ruled blocked.
// `taifoon markets` reads it, the canonical MARKETPLACES.md is generated from it (scripts/marketplaces-doc.mjs; a drift gate
// fails when the doc drifts), and the spec page's "Marketplaces and the CLI" matrix is the same rows.
//
// status   live           discover + hire through the one pipeline on production /v1 today (settle plans on the devnet by default)
//          devnet         the seller itself runs on the Taifoon devnet 36927 (free gas, test tokens)
//          discover-only  listed and searchable through /v1; nothing is hired through it yet
//          blocked        needs something only the owner can give (an account, a key, an MFA session, a yes); `why` says what
// lane     the loop-studio lane that proved the hire (workflows/lanes.mjs; docs/LOOP-STUDIO.md, the tick named in `proof`)
// discover the /v1 read that lists its sellers (every read is metered by the layer); count(json) → { sellers, note }
// search   the /v1 read one query goes to, and how its rows become { ref, name, detail, ready }
// hire     how a job reaches a seller: `handshake` (POST /v1/handshake, candidate kind …), or `onchain` (an unsigned plan)
// unblock  what activates the parts that are not live, in the owner's terms (keys, MFA, decisions)

const s = (v, n = 90) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : v ?? null);
const q = (x) => encodeURIComponent(x);
const has = (text, needle) => String(text ?? '').toLowerCase().includes(String(needle).toLowerCase());

export const STATUSES = ['live', 'devnet', 'discover-only', 'blocked'];

export const MARKETS = [
  {
    id: 'erc8004', name: 'ERC-8004 agents (14 chains)', where: 'Base, Ethereum, BNB, Arbitrum, Celo, Arc, Robinhood, Abstract, X Layer, Gnosis, Avalanche, Optimism, Polygon, Monad', status: 'live',
    lane: 'broker (every lane)', klass: 'every class', proof: 'harvester + /v1/agents/hireable',
    discover: { path: '/v1/agents/hireable?limit=1', count: (j) => ({ sellers: j?.total ?? null, note: j ? `${Object.keys(j.by_chain ?? {}).length} chains · ${(j.by_protocol?.mcp ?? 0).toLocaleString('en-US')} mcp · ${(j.by_protocol?.a2a ?? 0).toLocaleString('en-US')} a2a · hireable today` : null }) },
    search: { path: (x) => `/v1/registry/search?q=${q(x)}&source=onchain&limit=10`, rows: (j) => (j?.hits ?? []).map((h) => ({ ref: h.chain && h.id ? `${h.chain}:${h.id}` : s(h.id, 40), name: s(h.name, 60), detail: s((h.skills ?? []).slice(0, 4).join(', ')), ready: h.hireable ? 'hireable' : 'listed' })) },
    hire: { kind: 'handshake', candidate: (ref) => { const [c, id] = String(ref).split(':'); return { kind: 'mcp', agentId: Number(id), chainId: Number(c) }; } },
    unblock: null,
  },
  {
    id: 'virtuals', name: 'Virtuals ACP (memo-ACP)', where: 'Base', status: 'live', lane: 'v · tfnhiresettlev01', klass: 'memoacp.transfer_token', proof: 'LOOP-STUDIO tick 5',
    discover: { path: '/v1/virtuals/sellers', count: (j) => ({ sellers: j?.total ?? j?.count ?? null, note: j ? `${j.answering ?? 0} answering · ${j.completing ?? 0} completing` : null }) },
    search: { path: () => '/v1/virtuals/sellers', rows: (j, x) => (j?.sellers ?? []).filter((r) => !x || has(r.seller, x) || (r.offerings ?? []).some((o) => has(o.name, x))).slice(0, 10)
      .map((r) => ({ ref: `8453:${r.seller}`, name: s((r.offerings ?? []).map((o) => o.name).filter(Boolean).slice(0, 2).join(', ') || 'memo-ACP seller', 60), detail: `${r.jobs ?? 0} jobs · answer rate ${r.answer_rate ?? '—'}`, ready: r.answered ? 'answering' : 'listed' })) },
    hire: { kind: 'onchain', how: 'createJob through the memo-ACP router on Base with Taifoon named as evaluator; the buyer signs every call (GET /v1/virtuals/sellers how_to_hire)' },
    unblock: 'a Base hire needs a funded buyer wallet and your explicit yes (the CLI prints the plan; it never sends on Base)',
  },
  {
    id: 'bitagent', name: 'BitAgent (ERC-8183, Unibase)', where: 'Base, BNB', status: 'live', lane: 't · tfnhiresettlet01', klass: 'text.tweet', proof: 'LOOP-STUDIO tick 6',
    discover: { path: '/v1/landscape', count: (j) => { const e = (j?.ecosystems ?? []).find((x) => x.id === 'bitagent'); return { sellers: null, note: e ? `${e.k1?.toLowerCase()} ${e.v1} · ${e.k2?.toLowerCase()} ${e.v2}` : null }; } },
    search: null,
    hire: { kind: 'handshake', candidate: (ref) => { const [c, id] = String(ref).split(':'); return { kind: 'a2a', agentId: Number(id), chainId: Number(c) }; } },
    unblock: 'the ERC-8183 evaluator seat on Base is proven on a fork only; a Base job needs a funded buyer and your yes',
  },
  {
    id: 'olas', name: 'Olas Mech marketplace', where: 'Base', status: 'live', lane: 'o · tfnhiresettleo01', klass: 'mech.compute', proof: 'LOOP-STUDIO tick 3',
    discover: { path: '/v1/olas/mechs', count: (j) => ({ sellers: j?.count ?? null, note: j ? `${j.hireable ?? 0} with a tool that answers lately` : null }) },
    search: { path: () => '/v1/olas/mechs', rows: (j, x) => (j?.mechs ?? []).filter((m) => !x || has(m.card?.name, x) || (m.card?.tools ?? []).some((t) => has(t, x)) || has(m.mech, x)).slice(0, 10)
      .map((m) => ({ ref: `8453:${m.mech}`, name: s(m.card?.name ?? `mech ${m.service_id}`, 60), detail: s((m.hireable_tools?.length ? m.hireable_tools : m.card?.tools ?? []).slice(0, 4).join(', ')), ready: m.hireable_tools?.length ? 'answers' : 'listed' })) },
    hire: { kind: 'onchain', how: 'request(bytes, maxDeliveryRate, paymentType, priorityMech, responseTimeout, paymentData) on the marketplace; paid at delivery (GET /v1/olas/mechs how_to_hire)' },
    unblock: 'a Base request needs a funded requester wallet and your yes',
  },
  {
    id: 'taifoon-mech', name: 'TaifoonMech (the layer as a mech)', where: 'Taifoon devnet 36927', status: 'devnet', lane: 'mech · /v1/mech/plan', klass: 'grade · proof · agent', proof: 'docs/COORD-MECH.md',
    discover: { path: '/v1/mech', count: (j) => ({ sellers: (j?.products ?? []).length || null, note: j ? `${(j.deployments ?? []).length} deployment(s) · refund by anyone after the deadline` : null }) },
    search: { path: () => '/v1/mech', rows: (j, x) => (j?.products ?? []).filter((p) => !x || has(p.name, x) || has(p.what, x)).map((p) => ({ ref: `36927:${p.name}`, name: s(p.name), detail: s(p.what), ready: 'devnet' })) },
    hire: { kind: 'mech' },
    unblock: 'a Base deployment is a decision only you make (none today)',
  },
  {
    id: 'agentverse', name: 'Fetch.ai Agentverse (uAgents)', where: 'Almanac (off chain)', status: 'live', lane: 'u · u2', klass: 'stats.describe · chat.word_count', proof: 'LOOP-STUDIO ticks 7, 8',
    discover: { path: '/v1/agentverse/agents?q=agent&limit=1', count: (j) => ({ sellers: j?.total ?? null, note: j?.total >= 10000 ? 'active agents in its public search (the search counts up to 10,000)' : 'active agents in its public search' }) },
    search: { path: (x) => `/v1/agentverse/agents?q=${q(x)}&limit=10`, rows: (j) => (j?.agents ?? []).map((a) => ({ ref: a.address, name: s(a.name, 60), detail: `${a.type ?? ''} · ${(a.protocols ?? []).map((p) => p.name).slice(0, 2).join(', ') || 'no protocol'}`, ready: a.unresponsive ? 'unresponsive' : a.status ?? 'listed' })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'uagents', address: ref }) },
    unblock: null,
  },
  {
    id: 'mcp-registry', name: 'Official MCP registry', where: 'registry.modelcontextprotocol.io', status: 'live', lane: 'r · tfnhiresettler01', klass: 'mcp.digest', proof: 'LOOP-STUDIO tick 10',
    discover: { path: '/v1/mcp/registry?limit=100', count: (j) => ({ sellers: j ? (j.next_cursor ? `${j.count}+` : j.count) : null, note: j ? `${j.open ?? 0} of the first ${j.count} open (a streamable-http remote, no header) · the registry pages by cursor` : null }) },
    search: { path: (x) => `/v1/mcp/registry?q=${q(x)}&limit=10`, rows: (j) => (j?.rows ?? []).map((r) => ({ ref: r.name, name: s(r.title ?? r.name, 60), detail: s(r.description), ready: r.open_remote ? (r.free ? 'open · free' : 'open') : 'packages only' })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'mcp-registry', address: ref }) },
    unblock: null,
  },
  {
    id: 'a2a-registry', name: 'A2A Registry', where: 'a2aregistry.org', status: 'live', lane: 'g · g2', klass: 'a2a.json_normalize', proof: 'LOOP-STUDIO tick 12',
    discover: { path: '/v1/a2a/registry?limit=1', count: (j) => ({ sellers: j?.total ?? null, note: 'A2A 1.0 and 0.3 dialects' }) },
    search: { path: (x) => `/v1/a2a/registry?search=${q(x)}&limit=10`, rows: (j) => (j?.rows ?? []).map((r) => ({ ref: `a2a:${r.id}`, name: s(r.name, 60), detail: s(r.description), ready: r.open ? `open · A2A ${r.dialect ?? ''}` : 'secured' })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'a2a-registry', address: String(ref).replace(/^a2a:/, '') }) },
    unblock: null,
  },
  {
    id: 'x402', name: 'x402 Bazaar (CDP facilitator)', where: 'Base, Arc', status: 'discover-only', lane: 'd · tfnhiresettled01 (built, dry-run)', klass: 'x402.chain_head', proof: 'LOOP-STUDIO ticks 8, 9',
    discover: { path: '/v1/x402/bazaar?limit=20', count: (j) => ({ sellers: j?.total ?? null, note: j ? `${j.payable ?? 0} of the first ${j.count ?? 0} payable on a layer chain` : null }) },
    search: { path: (x) => `/v1/x402/bazaar?q=${q(x)}&limit=100`, rows: (j) => (j?.rows ?? []).slice(0, 10).map((r) => ({ ref: r.resource, name: s(r.service ?? r.host, 50), detail: s(r.description), ready: `${r.readiness?.status ?? 'listed'}${r.cheapest_usdc_on_layer !== null && r.cheapest_usdc_on_layer !== undefined ? ` · ${r.cheapest_usdc_on_layer} USDC` : ''}` })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'x402', address: ref }) },
    unblock: 'the first paid call (0.001 USDC on Base from the operations wallet, KMS) waits on an mbf MFA session and your yes',
  },
  {
    id: 'agentkit', name: 'Coinbase AgentKit', where: 'Taifoon devnet 36927', status: 'devnet', lane: 'k · tfnhiresettlek01', klass: 'agentkit.erc20_transfer', proof: 'LOOP-STUDIO tick 11',
    discover: { path: '/v1/agentkit', count: (j) => ({ sellers: j?.count ?? null, note: 'AgentKit workers registered with the layer' }) },
    search: { path: () => '/v1/agentkit', rows: (j, x) => (j?.workers ?? []).filter((w) => !x || has(w.name, x) || has(w.description, x)).map((w) => ({ ref: `agentkit:${w.address}`, name: s(w.name, 60), detail: s((w.agentkit?.served ?? []).map((a) => a.name).join(', ')), ready: 'devnet' })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'mcp', address: String(ref).replace(/^agentkit:/, '') }) },
    unblock: 'a mainnet AgentKit worker is a decision only you make (its wallet would hold real funds)',
  },
  {
    id: 'hashproof', name: 'HashProof (ERC-8004 on Celo)', where: 'Celo', status: 'live', lane: 'e · tfnhiresettlee01', klass: 'credential.verify.celo', proof: 'LOOP-STUDIO tick 17',
    discover: { path: '/v1/hashproof/credentials', count: (j) => ({ sellers: (j?.agents ?? []).length || null, note: j ? `${j.registered ?? 0} credentials registered in the window` : null }) },
    search: { path: () => '/v1/hashproof/credentials', rows: (j, x) => (j?.agents ?? []).filter((a) => !x || has(a.name, x) || has(a.url, x)).map((a) => ({ ref: `${a.chain_id}:${a.agent_id}`, name: s(a.name), detail: s(a.url), ready: 'hireable' })) },
    hire: { kind: 'handshake', candidate: (ref) => { const [c, id] = String(ref).split(':'); return { kind: 'mcp', agentId: Number(id), chainId: Number(c) }; } },
    unblock: null,
  },
  {
    id: 'n8n', name: 'n8n (seller and buyer)', where: 'n8n.io + n8n.taifoon.dev', status: 'live', lane: 'n · tfnhiresettlen01', klass: 'typed.compile', proof: 'LOOP-STUDIO tick 2',
    discover: { path: '/v1/capabilities/search?limit=1', count: (j) => ({ sellers: j?.total ?? null, note: 'templates + community nodes (capabilities; a webhook seller is hireable)' }) },
    search: { path: (x) => `/v1/capabilities/search?q=${q(x)}&limit=10`, rows: (j) => (j?.results ?? j?.rows ?? j?.capabilities ?? []).map((r) => ({ ref: s(r.id ?? r.url, 60), name: s(r.name ?? r.title, 60), detail: s(r.kind ?? r.source), ready: 'capability' })) },
    hire: { kind: 'handshake', candidate: (ref) => ({ kind: 'n8n', address: ref }) },
    unblock: null,
  },
  {
    id: 'phala', name: 'Phala TEE (dstack)', where: 'Taifoon devnet 36927 (simulator)', status: 'devnet', lane: 'p · tfnhiresettlep01', klass: 'tee.typed.compile', proof: 'LOOP-STUDIO tick 4',
    discover: { path: '/v1/landscape', count: (j) => { const e = (j?.ecosystems ?? []).find((x) => x.id === 'phala'); return { sellers: null, note: e ? `${e.k1?.toLowerCase()} ${e.v1} · ${e.k2?.toLowerCase()} ${e.v2}` : null }; } },
    search: null,
    hire: { kind: 'handshake', candidate: () => ({ kind: 'mcp', agentId: 17, chainId: 36927 }) },
    unblock: 'a real enclave: one funded CVM run (about $0.044, auto teardown) needs your yes; today the quote comes from the dstack simulator',
  },
  {
    id: 'cctp', name: 'CCTP V2 cross-chain (Base ↔ Arc)', where: 'Base, Arc', status: 'live', lane: 'x · tfnhiresettlex01', klass: 'transfer.attest.cctp', proof: 'LOOP-STUDIO tick 1',
    discover: { path: '/v1/chains', count: (j) => ({ sellers: j?.chain_count ?? null, note: 'chains the layer moves value between (CctpFeeRouterV3 on Base and Arc)' }) },
    search: { path: () => '/v1/chains', rows: (j, x) => (j?.chains ?? []).filter((c) => !x || has(c.name, x) || String(c.chain_id) === String(x)).slice(0, 10).map((c) => ({ ref: `chain:${c.chain_id}`, name: s(c.name), detail: `${c.protocol_count ?? 0} protocols`, ready: (c.protocols ?? []).includes('cctp') ? 'cctp' : 'listed' })) },
    hire: { kind: 'handshake', candidate: () => ({ kind: 'mcp', agentId: 95902, chainId: 8453 }) },
    unblock: null,
  },
  {
    id: 'gateway', name: 'Taifoon λ gateways (drop-in MCP)', where: 'coord.taifoon.dev/gw', status: 'live', lane: 'gateway (λ lease)', klass: 'any tool', proof: 'docs/LAMBDA-GRID-DESIGN.md §4.1',
    discover: { path: '/v1/gw/resources', count: (j) => ({ sellers: j?.count ?? null, note: 'MCP live; A2A, RPC, x402, Olas, Virtuals gateways are design' }) },
    search: { path: () => '/v1/gw/resources', rows: (j, x) => (j?.resources ?? []).filter((r) => !x || has(r.id, x) || (r.tools ?? []).some((t) => has(t, x)) || (r.classes ?? []).some((c) => has(c, x))).map((r) => ({ ref: r.id, name: s(r.slug, 50), detail: s((r.tools ?? []).slice(0, 4).join(', ')), ready: `gateway · ${r.price?.amount ?? '0'} ${r.price?.unit ?? ''}` })) },
    hire: { kind: 'gateway' },
    unblock: null,
  },
  {
    id: 'nevermined', name: 'Nevermined', where: 'Base, Solana (x402, mpp)', status: 'blocked', lane: '—', klass: '—', proof: 'LOOP-STUDIO tick 11',
    discover: { path: '/v1/nevermined/catalog?limit=1', count: (j) => ({ sellers: j?.total ?? null, note: j ? `${j.operational ?? 0} operational · ${Object.entries(j.by_protocol ?? {}).map(([k, v]) => `${v} ${k}`).join(' · ')}` : null }) },
    search: { path: (x) => `/v1/nevermined/catalog?q=${q(x)}&limit=10`, rows: (j) => (j?.rows ?? []).map((r) => ({ ref: r.id, name: s(r.name, 60), detail: s(r.description), ready: `${r.health ?? '—'} · ${r.price ?? '—'}` })) },
    hire: { kind: 'blocked' },
    unblock: 'a Nevermined API key (sandbox first): a person signs in at nevermined.app; every call goes through its Router, which refuses anonymous access',
    needs: ['account: nevermined.app (you sign in)', 'key: Nevermined API key → taifoon login stores it in the Keychain as nevermined-api-key', 'decision: which sandbox merchant to hire first'],
  },
  {
    id: 'skyfire', name: 'Skyfire', where: 'Skyfire network (KYA / pay tokens)', status: 'blocked', lane: '—', klass: '—', proof: 'LOOP-STUDIO tick 11',
    discover: { path: '/v1/skyfire/directory?limit=1', count: (j) => ({ sellers: j?.total ?? null, note: j ? `${Object.entries(j.by_type ?? {}).slice(0, 3).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')}` : null }) },
    search: { path: (x) => `/v1/skyfire/directory?q=${q(x)}&limit=10`, rows: (j) => (j?.rows ?? []).map((r) => ({ ref: r.id, name: s(r.name, 60), detail: s(r.description), ready: `${r.type ?? ''} · ${r.price_usd ?? '—'} USD` })) },
    hire: { kind: 'blocked' },
    unblock: 'a Skyfire buyer API key: it comes with an account at app.skyfire.xyz; every call carries a KYA or pay token minted with it',
    needs: ['account: app.skyfire.xyz (you sign up)', 'key: Skyfire buyer API key (sandbox first)', 'decision: a spend cap for pay tokens'],
  },
  {
    id: 'elizaos', name: 'ElizaOS', where: 'self-hosted (devnet, telemetry off)', status: 'blocked', lane: '—', klass: '—', proof: 'LOOP-STUDIO tick 12',
    discover: null, search: null, hire: { kind: 'blocked' },
    unblock: 'a model-provider key: its plugin registry lists plugins, not agents anyone can call, so the lane is an Eliza agent we run on the devnet, and it needs a model key to answer',
    needs: ['key: a model-provider API key for the self-hosted agent', 'decision: which provider and a monthly cap'],
  },
  {
    id: 'pearl', name: 'Pearl Connect (Olas)', where: 'Base (Olas marketplace)', status: 'blocked', lane: '—', klass: 'mech.compute', proof: 'docs/COORD-MECH.md §2 option A',
    discover: { path: '/v1/olas/mechs', count: (j) => ({ sellers: j?.count ?? null, note: 'Pearl agents buy from these mechs' }) },
    search: null, hire: { kind: 'blocked' },
    unblock: 'register our mech on the Olas marketplace so Pearl agents reach it: 1 Base transaction plus a deposit, our worker key owns a Safe, Olas takes 15 % and has no refund — your yes',
    needs: ['decision: your yes to option A (COORD-MECH.md §2)', 'MFA: an mbf session for the one Base transaction', 'funds: the Olas service deposit'],
  },
];

export const market = (id) => MARKETS.find((m) => m.id === String(id ?? '').toLowerCase()) ?? null;

/** The matrix row the spec page and docs/MARKETPLACES.md print (pure). */
export function matrixRow(m) {
  const cmd = m.status === 'blocked' ? `taifoon markets connect ${m.id}` : m.hire?.kind === 'handshake' ? `taifoon markets hire ${m.id} <ref>` : m.hire?.kind === 'mech' ? `taifoon markets hire ${m.id} grade` : `taifoon markets connect ${m.id}`;
  return { id: m.id, name: m.name, where: m.where, status: m.status, lane: m.lane, klass: m.klass, discover: m.discover?.path?.split('?')[0] ?? '—', unblock: m.unblock ?? '—', command: cmd, proof: m.proof };
}
