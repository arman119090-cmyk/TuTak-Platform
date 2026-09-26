// Offline tests for scripts/ai-review.mjs. No network: `fetch` is injected.
//
//   node --test scripts/ai-review.test.mjs
//
// Scenarios required by the launch-readiness closure task:
//   1. no Kimi key            → Kimi BLOCKED_BY_API_KEY, verdict NOT GREEN
//   2. no DeepSeek key        → DeepSeek BLOCKED_BY_API_KEY, verdict NOT GREEN
//   3. neither key            → both BLOCKED_BY_API_KEY, verdict NOT GREEN
//   4. provider timeout/error → PROVIDER_FAILURE, verdict NOT GREEN
//   5. invalid JSON           → INVALID_RESPONSE, verdict NOT GREEN
//   6. Kimi ok + DeepSeek err → verdict NOT GREEN (PROVIDER_FAILURE headline)
//   7. both succeed           → both REVIEW_COMPLETE, verdict GREEN, exit 0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runReview, runVerdict, computeVerdict, parseFindings, STATUSES } from './ai-review.mjs';

const FINDINGS = [
  {
    severity: 'P1',
    category: 'money',
    file: 'apps/api/src/x.ts',
    line: 12,
    finding: 'ledger entry not idempotent',
    evidence: 'no key',
    suggestedFix: 'add key',
    confidence: 0.8,
  },
];

const okResponse = (content, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage }),
  text: async () => content,
});
const httpError = (status, text = 'boom') => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => text,
});

/** Builds a fetch stub: model calls answer per provider (by base URL host), GitHub calls are recorded. */
function fakeFetch({ kimi, deepseek }) {
  const github = [];
  const modelCalls = { kimi: 0, deepseek: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.github.com/')) {
      github.push({ url: u, method: init.method ?? 'GET' });
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    const which = u.includes('kimi.test')
      ? 'kimi'
      : u.includes('deepseek.test')
        ? 'deepseek'
        : null;
    assert.ok(which, `unexpected URL ${u}`);
    modelCalls[which] += 1;
    const behaviour = which === 'kimi' ? kimi : deepseek;
    if (typeof behaviour === 'function') return behaviour(init);
    return behaviour;
  };
  return { fetchImpl, github, modelCalls };
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-test-'));
  const diff = join(dir, 'pr.diff');
  writeFileSync(diff, 'diff --git a/apps/api/src/x.ts b/apps/api/src/x.ts\n+const a = 1;\n');
  return {
    dir,
    out: join(dir, 'out'),
    diff,
    output: join(dir, 'gh-output.txt'),
    summary: join(dir, 'gh-summary.md'),
  };
}

function envFor(provider, key, s, extra = {}) {
  return {
    AI_REVIEW_PROVIDER: provider,
    AI_REVIEW_API_KEY: key,
    AI_REVIEW_BASE_URL: `https://${provider}.test/v1`,
    AI_REVIEW_MODEL: `${provider}-model`,
    AI_REVIEW_OUT_DIR: s.out,
    AI_REVIEW_RETRIES: '1',
    AI_REVIEW_TIMEOUT_MS: '30',
    GITHUB_OUTPUT: s.output,
    GITHUB_STEP_SUMMARY: s.summary,
    GITHUB_SHA: 'deadbeef',
    ...extra,
  };
}

const quiet = { log: () => {}, print: () => {} };
const noSleep = async () => {};

async function runBoth(s, { kimiKey, deepseekKey, kimi, deepseek, extra }) {
  const ff = fakeFetch({ kimi, deepseek });
  const k = await runReview({
    env: envFor('kimi', kimiKey, s, extra),
    argv: [s.diff],
    fetchImpl: ff.fetchImpl,
    sleep: noSleep,
    ...quiet,
  });
  const d = await runReview({
    env: envFor('deepseek', deepseekKey, s, extra),
    argv: [s.diff],
    fetchImpl: ff.fetchImpl,
    sleep: noSleep,
    ...quiet,
  });
  const v = await runVerdict({
    env: {
      AI_REVIEW_OUT_DIR: s.out,
      GITHUB_OUTPUT: s.output,
      GITHUB_STEP_SUMMARY: s.summary,
      ...(extra ?? {}),
    },
    argv: ['--verdict', s.out, 'kimi,deepseek'],
    fetchImpl: ff.fetchImpl,
    ...quiet,
  });
  return { k, d, v, ff };
}

test('1. no Kimi key → Kimi BLOCKED_BY_API_KEY, DeepSeek REVIEW_COMPLETE, verdict NOT GREEN, no Kimi model call', async () => {
  const s = scratch();
  const { k, d, v, ff } = await runBoth(s, {
    kimiKey: '',
    deepseekKey: 'ds-key',
    deepseek: okResponse(JSON.stringify(FINDINGS)),
  });
  assert.equal(k.status, 'BLOCKED_BY_API_KEY');
  assert.equal(d.status, 'REVIEW_COMPLETE');
  assert.equal(ff.modelCalls.kimi, 0, 'a missing key must never reach the provider');
  assert.equal(ff.modelCalls.deepseek, 1);
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'BLOCKED_BY_API_KEY');
  assert.equal(v.exitCode, 1);
  assert.match(
    readFileSync(s.output, 'utf8'),
    /status=BLOCKED_BY_API_KEY[\s\S]*status=REVIEW_COMPLETE[\s\S]*verdict=BLOCKED_BY_API_KEY\ngreen=false/,
  );
});

test('2. no DeepSeek key → DeepSeek BLOCKED_BY_API_KEY, verdict NOT GREEN', async () => {
  const s = scratch();
  const { k, d, v, ff } = await runBoth(s, {
    kimiKey: 'k-key',
    deepseekKey: undefined,
    kimi: okResponse('[]'),
  });
  assert.equal(k.status, 'REVIEW_COMPLETE');
  assert.equal(k.findings.length, 0);
  assert.equal(d.status, 'BLOCKED_BY_API_KEY');
  assert.equal(ff.modelCalls.deepseek, 0);
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'BLOCKED_BY_API_KEY');
  assert.deepEqual(
    v.per.map((x) => x.status),
    ['REVIEW_COMPLETE', 'BLOCKED_BY_API_KEY'],
  );
});

test('3. neither key → both BLOCKED_BY_API_KEY, verdict NOT GREEN, zero model calls', async () => {
  const s = scratch();
  const { k, d, v, ff } = await runBoth(s, { kimiKey: '   ', deepseekKey: '' });
  assert.equal(k.status, 'BLOCKED_BY_API_KEY');
  assert.equal(d.status, 'BLOCKED_BY_API_KEY');
  assert.deepEqual(ff.modelCalls, { kimi: 0, deepseek: 0 });
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'BLOCKED_BY_API_KEY');
  assert.equal(v.exitCode, 1);
  const summary = readFileSync(s.summary, 'utf8');
  assert.match(summary, /Kimi \(diff\) — \*\*BLOCKED_BY_API_KEY\*\*/);
  assert.match(summary, /DeepSeek \(diff\) — \*\*BLOCKED_BY_API_KEY\*\*/);
  assert.match(summary, /NOT GREEN: BLOCKED_BY_API_KEY/);
});

test('4a. provider timeout → PROVIDER_FAILURE after the retries, verdict NOT GREEN', async () => {
  const s = scratch();
  // Never resolves until the script's own AbortController fires (AI_REVIEW_TIMEOUT_MS=30).
  const hang = (init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
      );
    });
  const { k, d, v, ff } = await runBoth(s, {
    kimiKey: 'k',
    deepseekKey: 'd',
    kimi: hang,
    deepseek: hang,
  });
  assert.equal(k.status, 'PROVIDER_FAILURE');
  assert.equal(d.status, 'PROVIDER_FAILURE');
  assert.match(k.detail, /unreachable|aborted/i);
  assert.equal(ff.modelCalls.kimi, 2, 'AI_REVIEW_RETRIES=1 → two attempts');
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'PROVIDER_FAILURE');
  assert.equal(v.exitCode, 1);
});

test('4b. provider HTTP 500 then 503 → PROVIDER_FAILURE; HTTP 401 → PROVIDER_FAILURE without retry', async () => {
  const s = scratch();
  let n = 0;
  const flaky = () => (n++ === 0 ? httpError(500, 'upstream') : httpError(503, 'busy'));
  const { k, d, ff } = await runBoth(s, {
    kimiKey: 'k',
    deepseekKey: 'd',
    kimi: flaky,
    deepseek: httpError(401, 'bad key'),
  });
  assert.equal(k.status, 'PROVIDER_FAILURE');
  assert.match(k.detail, /503/);
  assert.equal(ff.modelCalls.kimi, 2);
  assert.equal(d.status, 'PROVIDER_FAILURE');
  assert.match(d.detail, /401/);
  assert.equal(ff.modelCalls.deepseek, 1, '4xx other than 429 is fatal, not retried');
});

test('5. invalid JSON from the model → INVALID_RESPONSE (not REVIEW_COMPLETE), raw answer kept, verdict NOT GREEN', async () => {
  const s = scratch();
  const prose = 'Looks fine to me! No issues found. { not: json';
  const { k, d, v } = await runBoth(s, {
    kimiKey: 'k',
    deepseekKey: 'd',
    kimi: okResponse(prose),
    deepseek: okResponse('Issues found: [1, 2, 3]'),
  });
  assert.equal(k.status, 'INVALID_RESPONSE');
  assert.equal(d.status, 'INVALID_RESPONSE', 'an array of non-objects is not a findings list');
  const saved = JSON.parse(readFileSync(join(s.out, 'kimi-diff.json'), 'utf8'));
  assert.equal(saved.status, 'INVALID_RESPONSE');
  assert.equal(saved.findings, null);
  assert.equal(saved.raw, prose);
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'INVALID_RESPONSE');
});

test('6. Kimi success + DeepSeek failure → verdict NOT GREEN with PROVIDER_FAILURE headline, Kimi findings still saved', async () => {
  const s = scratch();
  const { k, d, v } = await runBoth(s, {
    kimiKey: 'k',
    deepseekKey: 'd',
    kimi: okResponse(JSON.stringify(FINDINGS)),
    deepseek: () => Promise.reject(new TypeError('fetch failed: ECONNRESET')),
  });
  assert.equal(k.status, 'REVIEW_COMPLETE');
  assert.equal(k.findings.length, 1);
  assert.equal(d.status, 'PROVIDER_FAILURE');
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'PROVIDER_FAILURE');
  assert.deepEqual(
    v.per.map((x) => [x.provider, x.status]),
    [
      ['kimi', 'REVIEW_COMPLETE'],
      ['deepseek', 'PROVIDER_FAILURE'],
    ],
  );
  assert.equal(JSON.parse(readFileSync(join(s.out, 'kimi-diff.json'), 'utf8')).findings.length, 1);
  assert.equal(
    existsSync(join(s.out, 'deepseek-diff.json')),
    false,
    'no findings file for a model that never answered',
  );
});

test('7. both succeed → both REVIEW_COMPLETE, verdict GREEN, exit 0, sticky comments posted once per marker', async () => {
  const s = scratch();
  const extra = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '71' };
  const { k, d, v, ff } = await runBoth(s, {
    kimiKey: 'k',
    deepseekKey: 'd',
    kimi: okResponse('Here you go:\n' + JSON.stringify(FINDINGS)),
    deepseek: okResponse('[]'),
    extra,
  });
  assert.equal(k.status, 'REVIEW_COMPLETE');
  assert.equal(d.status, 'REVIEW_COMPLETE');
  assert.equal(v.green, true);
  assert.equal(v.verdict, 'REVIEW_COMPLETE');
  assert.equal(v.exitCode, 0);
  assert.equal(k.comment.posted, true);
  assert.equal(d.comment.posted, true);
  const posts = ff.github.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 3, 'Kimi + DeepSeek + verdict comment');
  const status = JSON.parse(readFileSync(join(s.out, 'kimi-diff.status.json'), 'utf8'));
  assert.equal(status.status, 'REVIEW_COMPLETE');
  assert.equal(status.findingsCount, 1);
  assert.equal(status.sha, 'deadbeef');
  const verdict = JSON.parse(readFileSync(join(s.out, 'verdict-diff.json'), 'utf8'));
  assert.equal(verdict.green, true);
  assert.match(readFileSync(s.output, 'utf8'), /verdict=REVIEW_COMPLETE\ngreen=true/);
});

test('empty diff (docs-only PR) → NOTHING_TO_REVIEW for both, verdict GREEN, no model call, key not needed', async () => {
  const s = scratch();
  writeFileSync(s.diff, '\n');
  const { k, d, v, ff } = await runBoth(s, { kimiKey: '', deepseekKey: '' });
  assert.equal(k.status, 'NOTHING_TO_REVIEW');
  assert.equal(d.status, 'NOTHING_TO_REVIEW');
  assert.deepEqual(ff.modelCalls, { kimi: 0, deepseek: 0 });
  assert.equal(v.green, true);
  assert.equal(v.verdict, 'NOTHING_TO_REVIEW');
});

test('missing status file → NOT_RUN; one REVIEW_COMPLETE + one NOTHING_TO_REVIEW is not GREEN', () => {
  const v = computeVerdict([{ provider: 'kimi', status: 'REVIEW_COMPLETE' }], ['kimi', 'deepseek']);
  assert.equal(v.green, false);
  assert.equal(v.verdict, 'NOT_RUN');
  const mixed = computeVerdict(
    [
      { provider: 'kimi', status: 'REVIEW_COMPLETE' },
      { provider: 'deepseek', status: 'NOTHING_TO_REVIEW' },
    ],
    ['kimi', 'deepseek'],
  );
  assert.equal(mixed.green, false);
  const unknown = computeVerdict(
    [
      { provider: 'kimi', status: 'GREEN' },
      { provider: 'deepseek', status: 'REVIEW_COMPLETE' },
    ],
    ['kimi', 'deepseek'],
  );
  assert.equal(unknown.per[0].status, 'NOT_RUN', 'an unknown status string is never trusted');
  assert.equal(unknown.green, false);
});

test('no input path → NOT_RUN; STATUSES is the closed list', async () => {
  const s = scratch();
  const r = await runReview({
    env: envFor('kimi', 'k', s),
    argv: [],
    fetchImpl: async () => assert.fail('no call expected'),
    ...quiet,
  });
  assert.equal(r.status, 'NOT_RUN');
  assert.deepEqual(
    [...STATUSES],
    [
      'REVIEW_COMPLETE',
      'BLOCKED_BY_API_KEY',
      'PROVIDER_FAILURE',
      'INVALID_RESPONSE',
      'NOTHING_TO_REVIEW',
      'NOT_RUN',
    ],
  );
});

test('parseFindings normalises fields and rejects non-arrays', () => {
  assert.equal(parseFindings('no json here'), null);
  assert.equal(parseFindings('{"a":1}'), null);
  assert.equal(parseFindings('[1, 2]'), null, 'non-object elements → invalid');
  assert.deepEqual(
    parseFindings('{"findings": []}'),
    [],
    'object wrapper with a findings array is accepted',
  );
  const parsed = parseFindings('```json\n[{"severity":"P9","line":"x","confidence":7}]\n```');
  assert.deepEqual(parsed, [
    {
      severity: 'P3',
      category: 'other',
      file: '',
      line: 0,
      finding: '',
      evidence: '',
      suggestedFix: '',
      confidence: 1,
    },
  ]);
});
