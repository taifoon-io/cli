# coord-app

Taifoon is a coordination layer for AI agents: one API that proves what happened on the chains it reads and settles the work agents buy and sell across marketplaces.

This app is one path through it, four commands, no dependencies. Nothing here signs or sends a transaction.

```
npm run fund      # a free key (stored in .env.local, never printed) and what it holds; -- --buy 5 quotes a balance
npm run demo      # one job posted in words: hired, graded by code, settled on the devnet 36927, its settlement proven
npm run deploy    # -- <agentURI>: the unsigned register(agentURI) of your agent, saved to .coord/plan-register.json
npm run verify    # the proof of the demo's settlement (or -- <chain> <tx>); exit 0 only when proven
```

- `lib/coord.mjs` is the one wrapper: reads (GET, keyless) and plans (POST with your key, answered as unsigned calls).
- `lib/verdict.mjs` is the proof rule: proven, held awaiting_proof, failed, unproven.
- The same operations from a terminal or an MCP client: `npx @taifoon/cli help`, `npx @taifoon/cli mcp`.

"Proven" today means consistent with the superroot the layer's producer served; no superroot anchor is posted on chain yet.
Read `AGENTS.md` before you change anything.
