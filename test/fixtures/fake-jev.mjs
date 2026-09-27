// A stand-in for @taifoon/jev in tests: the STEPS shape and a pipeline() that walks them and returns a trace.
export const STEPS = [
  { id: 'pick', title: 'Pick the job', route: 'GET /v1/judge/queue', required: true },
  { id: 'grade', title: 'Grade it', route: 'POST /v1/trial' },
  { id: 'verify', title: 'Verify the record', route: null },
];
export const calls = [];
export async function pipeline(o) {
  calls.push(o);
  const trace = { job: { chainId: 8453, jobId: '81100', seller: '0xabc' }, steps: [], receipt: null, recorded: null, layerRecord: null, evaluator: null, quote: null, verification: null };
  const results = { pick: { id: 'pick', ok: true, ms: 12, out: { jobId: '81100' } }, grade: { id: 'grade', ok: false, ms: 40, error: 'the trial answered 429' }, verify: { id: 'verify', ok: true, ms: 0, skipped: 'nothing was recorded' } };
  for (const s of STEPS) {
    if (!(await o.before(s, trace))) { trace.steps.push({ id: s.id, ok: true, ms: 0, skipped: 'skipped at the gate' }); continue; }
    const r = results[s.id];
    trace.steps.push(r);
    await o.after(r, trace);
  }
  trace.receipt = { verdict: 'needs_review', receiptHash: '0xfeed' };
  return trace;
}
