export const CASE_IDS = ['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'DA01', 'DA02', 'DA03', 'DA04', 'DA05', 'DA06'];
export const DISCLAIMER = 'SIMULATION ONLY — not a live, browser, performance or field result. No real aircraft, warnings, provider inference, recording or submission.';

export function buildReceipt(input) {
  if (!['date', 'git_sha', 'node', 'os', 'cpu'].every(key => typeof input[key] === 'string')
    || typeof input.working_tree_dirty !== 'boolean' || !Number.isSafeInteger(input.seed)
    || !Number.isFinite(input.duration_ms) || input.duration_ms < 0) throw new TypeError('Invalid receipt metadata');
  const cases = CASE_IDS.map(id => {
    const row = input.cases?.[id];
    if (!row) return { id, status: 'skipped', reason: 'Not executed.' };
    if (!['pass', 'fail', 'skipped'].includes(row.status) || typeof row.reason !== 'string' || !row.reason.trim()) {
      throw new TypeError('Each case needs a valid status and reason');
    }
    return { id, status: row.status, reason: row.reason };
  });
  const counts = Object.fromEntries(['pass', 'fail', 'skipped'].map(status => [status, cases.filter(c => c.status === status).length]));
  const checks = (input.checks ?? []).map(({ name, status, reason, duration_ms }) => {
    if (!['pass', 'fail', 'skipped'].includes(status) || typeof name !== 'string' || typeof reason !== 'string'
      || !Number.isFinite(duration_ms) || duration_ms < 0) throw new TypeError('Invalid local check');
    return { name, status, reason, duration_ms };
  });
  return {
    mode: 'simulated-local-rehearsal', disclaimer: DISCLAIMER,
    date: input.date, git_sha: input.git_sha, working_tree_dirty: input.working_tree_dirty,
    node: input.node, os: input.os, cpu: input.cpu, seed: input.seed, duration_ms: input.duration_ms,
    genuine_provider_calls: 0,
    aggregate: counts.fail || checks.some(c => c.status === 'fail') ? 'fail' : counts.skipped || checks.some(c => c.status === 'skipped') ? 'incomplete' : 'pass',
    counts, cases, checks,
  };
}

export function receiptMarkdown(r) {
  const cell = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return `# Local acceptance receipt\n\n**${r.disclaimer}**\n\nMode: \`${r.mode}\` · aggregate: **${r.aggregate}**\n\n`
    + `Date: ${r.date}\n\nGit: ${r.git_sha} (working tree dirty: ${r.working_tree_dirty})\n\n`
    + `Node: ${r.node}\n\nOS: ${r.os}\n\nCPU: ${r.cpu}\n\nSeed: ${r.seed} · duration: ${r.duration_ms} ms · genuine provider calls: 0\n\n`
    + `## Issue acceptance gates\n\n| Case | Status | Reason |\n|---|---|---|\n`
    + r.cases.map(c => `| ${c.id} | ${c.status} | ${cell(c.reason)} |`).join('\n')
    + `\n\nCounts: ${r.counts.pass} pass / ${r.counts.fail} fail / ${r.counts.skipped} skipped. Skips are not passes.\n\n`
    + `## Bounded executed checks (not full issue acceptance)\n\n| Check | Status | Duration ms | Reason |\n|---|---|---|---|\n`
    + r.checks.map(c => `| ${cell(c.name)} | ${c.status} | ${c.duration_ms} | ${cell(c.reason)} |`).join('\n') + '\n';
}
