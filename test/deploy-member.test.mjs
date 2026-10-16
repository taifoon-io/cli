// D7: the member-contract deploy plan — the outlet gate, the mainnet own-signer rule, and a CREATE2 address that depends only on the
// member, the label and the code (live on devnet 36927: MemberBox 0x14dB488E625f06ad8aa24D672121F1961A5813B9, tx 0x83bc5b98…8a59).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { memberPlan, outletOf, CREATE2_DEPLOYER } from '../src/deploy-member.mjs';

const hasCast = spawnSync('cast', ['--version']).status === 0;
const M = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CODE = '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea164736f6c6343000818000a';

test('the outlet of a chain', () => {
  assert.equal(outletOf(36927), 'devnet'); assert.equal(outletOf(3692781), 'taifoon'); assert.equal(outletOf(8453), 'mainnet');
});

test('a plan is refused by name without the outlet, and on mainnet without the member\'s own signer', { skip: !hasCast && 'cast not on PATH' }, () => {
  const no = memberPlan({ chainId: 36927, member: M, bytecode: CODE, label: 't', outlets: ['mainnet'] });
  assert.equal(no.ok, false); assert.match(no.refusals[0], /^outlet_not_granted/);
  const main = memberPlan({ chainId: 8453, member: M, bytecode: CODE, label: 't', outlets: ['mainnet'] });
  assert.equal(main.ok, false); assert.match(main.refusals[0], /own-signer/);
  assert.equal(memberPlan({ chainId: 8453, member: M, bytecode: CODE, label: 't', outlets: ['mainnet'], ownSigner: true }).ok, true);
});

test('the CREATE2 address is deterministic per member, label and code; the tx goes to the deterministic deployer from the member', { skip: !hasCast && 'cast not on PATH' }, () => {
  const a = memberPlan({ chainId: 36927, member: M, bytecode: CODE, label: 'x', outlets: ['devnet'] });
  const b = memberPlan({ chainId: 36927, member: M, bytecode: CODE, label: 'x', outlets: ['devnet'] });
  const c = memberPlan({ chainId: 36927, member: M, bytecode: CODE, label: 'y', outlets: ['devnet'] });
  assert.equal(a.address, b.address); assert.notEqual(a.address, c.address);
  assert.equal(a.tx.to, CREATE2_DEPLOYER); assert.equal(a.tx.from, M); assert.ok(a.tx.data.startsWith(a.salt));
  assert.match(a.signer, /never a Taifoon key/);
});
