#!/usr/bin/env node
/**
 * Asks one OpenAI-compatible chat model to review a diff (or a whole module
 * tree) and posts the answer as a sticky PR comment, with the findings also
 * saved as JSON. Used by .github/workflows/ai-review.yml for Kimi (Moonshot)
 * and DeepSeek; both speak the /chat/completions dialect and are called
 * independently — neither sees the other's verdict (AGENTS.md §4).
 *
 *   AI_REVIEW_PROVIDER=kimi AI_REVIEW_API_KEY=... node scripts/ai-review.mjs pr.diff
 *   AI_REVIEW_MODE=full    node scripts/ai-review.mjs apps/api/src/modules/ledger   # weekly audit
 *   node scripts/ai-review.mjs --verdict ai-review-out kimi,deepseek               # combine
 *
 * Every run ends in exactly one STATUS, written to
 * `<out>/<provider>-<mode>.status.json`, to `$GITHUB_OUTPUT` (status=…), to
 * `$GITHUB_STEP_SUMMARY` and into the sticky PR comment:
 *
 *   REVIEW_COMPLETE     the model answered with findings in the requested JSON shape
 *   BLOCKED_BY_API_KEY  no API key in GitHub Secrets — the model was never called
 *   PROVIDER_FAILURE    the model was called and did not answer (HTTP error, timeout, network)
 *   INVALID_RESPONSE    the model answered, but not with a JSON array of findings
 *   NOTHING_TO_REVIEW   the input holds no reviewable code (docs-only PR); no model call
 *   NOT_RUN             wrong invocation (no path / path missing) or the step crashed
 *
 * A per-provider run always exits 0 so that the second model still runs; the
 * `--verdict` sub-command then reads all status files and exits 1 unless
 * every expected provider is REVIEW_COMPLETE (or every one is
 * NOTHING_TO_REVIEW). That is what makes the job GREEN only when the review
 * really happened. The job is advisory and must NOT be a required check
 * while the keys are absent — it would block every PR (workflow header).
 *
 * Findings are requested as JSON matching FINDING_SCHEMA (severity, category,
 * file, line, finding, evidence, suggestedFix, confidence) so a later
 * decision engine can consume them; the human-readable table is rendered
 * from the same objects.
 *
 * The module is importable: `runReview()` and `computeVerdict()` take an
 * injectable `fetchImpl`, so scripts/ai-review.test.mjs exercises every
 * status without calling a paid API.
 */
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  realpathSync,
} from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = Object.freeze([
  'REVIEW_COMPLETE',
  'BLOCKED_BY_API_KEY',
  'PROVIDER_FAILURE',
  'INVALID_RESPONSE',
  'NOTHING_TO_REVIEW',
  'NOT_RUN',
]);

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const FINDING_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: [
      'severity',
      'category',
      'file',
      'line',
      'finding',
      'evidence',
      'suggestedFix',
      'confidence',
    ],
    properties: {
      severity: { enum: SEVERITIES },
      category: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'integer' },
      finding: { type: 'string' },
      evidence: { type: 'string' },
      suggestedFix: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

const labelOf = (provider) =>
  provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : provider;
const defaultSleep = (ms) => new Promise((res) => setTimeout(res, ms));

function collectSource(root) {
  const keep = new Set(['.ts', '.tsx', '.mjs', '.js', '.prisma', '.sql']);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (keep.has(extname(name)) && !/\.(spec|int-spec|e2e)\./.test(name)) {
        out.push(`// ===== ${full}\n${readFileSync(full, 'utf8')}`);
      }
    }
  };
  walk(root);
  return out.join('\n\n');
}

/** Upserts one PR comment per marker (never spams); prints the body when there is no PR context. */
async function postStickyComment({ env, fetchImpl, log, print, marker, body }) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  const number = env.PR_NUMBER;
  if (!token || !repo || !number) {
    log('no PR context; printing instead');
    print(body);
    return { posted: false };
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const list = await fetchImpl(
    `https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100`,
    { headers },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const mine = Array.isArray(list)
    ? list.find((c) => typeof c.body === 'string' && c.body.includes(marker))
    : null;
  const payload = JSON.stringify({ body: `${marker}\n${body}` });
  const result = mine
    ? await fetchImpl(`https://api.github.com/repos/${repo}/issues/comments/${mine.id}`, {
        method: 'PATCH',
        headers,
        body: payload,
      }).catch(() => null)
    : await fetchImpl(`https://api.github.com/repos/${repo}/issues/${number}/comments`, {
        method: 'POST',
        headers,
        body: payload,
      }).catch(() => null);
  if (!result || !result.ok) {
    log(`could not post the comment (${result ? result.status : 'network'}); printing instead`);
    print(body);
    return { posted: false };
  }
  log(mine ? 'updated the sticky comment' : 'posted the sticky comment');
  return { posted: true, updated: Boolean(mine) };
}

/**
 * Extracts the findings array. Accepts a bare array, a fenced array, or an
 * object with a `findings` array. Returns null (→ INVALID_RESPONSE) when
 * there is no array, or when the array holds anything but objects — a
 * "[1, 2]" buried in prose must never count as a clean review.
 */
export function parseFindings(text) {
  if (typeof text !== 'string') return null;
  const stripped = text.replace(/```[a-z]*\n?/gi, '').trim();
  let arr = null;
  try {
    const whole = JSON.parse(stripped);
    if (Array.isArray(whole)) arr = whole;
    else if (whole && typeof whole === 'object' && Array.isArray(whole.findings))
      arr = whole.findings;
  } catch {
    /* fall through to the slice */
  }
  if (arr === null) {
    const start = stripped.indexOf('[');
    const end = stripped.lastIndexOf(']');
    if (start < 0 || end < start) return null;
    try {
      const sliced = JSON.parse(stripped.slice(start, end + 1));
      if (!Array.isArray(sliced)) return null;
      arr = sliced;
    } catch {
      return null;
    }
  }
  if (!arr.every((f) => f && typeof f === 'object' && !Array.isArray(f))) return null;
  return arr.map((f) => ({
    severity: SEVERITIES.includes(f.severity) ? f.severity : 'P3',
    category: String(f.category ?? 'other'),
    file: String(f.file ?? ''),
    line: Number.isInteger(f.line) ? f.line : 0,
    finding: String(f.finding ?? ''),
    evidence: String(f.evidence ?? ''),
    suggestedFix: String(f.suggestedFix ?? ''),
    confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0,
  }));
}

function githubOutputs(env, entries) {
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      entries.map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`).join('\n') + '\n',
    );
  }
}
function githubSummary(env, markdown) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown + '\n\n');
}

/**
 * Runs one provider's review. Never throws for provider/input problems —
 * they become a STATUS. Returns { status, detail, findings, statusFile }.
 */
export async function runReview({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  log = (msg) => console.log(msg),
  print = (body) => console.log(body),
} = {}) {
  const provider = env.AI_REVIEW_PROVIDER ?? 'model';
  const apiKey = env.AI_REVIEW_API_KEY?.trim();
  const baseUrl = (env.AI_REVIEW_BASE_URL ?? '').replace(/\/$/, '');
  const model = env.AI_REVIEW_MODEL ?? '';
  const mode = env.AI_REVIEW_MODE === 'full' ? 'full' : 'diff';
  const target = argv[0];
  const MAX_INPUT_CHARS = Number(env.AI_REVIEW_MAX_INPUT_CHARS ?? 120_000);
  const MAX_OUTPUT_TOKENS = Number(env.AI_REVIEW_MAX_OUTPUT_TOKENS ?? 4_000);
  const TIMEOUT_MS = Number(env.AI_REVIEW_TIMEOUT_MS ?? 180_000);
  const RETRIES = Number(env.AI_REVIEW_RETRIES ?? 2);
  const OUT_DIR = env.AI_REVIEW_OUT_DIR ?? 'ai-review-out';
  // Sampling temperature sent to the model. Default 0.1 (deterministic
  // review). Empty string = do not send the field at all: Moonshot's current
  // models (kimi-k3, kimi-k2.7-code, kimi-k2.6) fix the temperature and
  // answer 400 "invalid temperature: only 1 is allowed" to any explicit
  // value — https://platform.kimi.ai/docs/api/models-overview.
  const TEMPERATURE_RAW =
    env.AI_REVIEW_TEMPERATURE === undefined ? '0.1' : env.AI_REVIEW_TEMPERATURE.trim();
  const TEMPERATURE = TEMPERATURE_RAW === '' ? undefined : Number(TEMPERATURE_RAW);
  const label = labelOf(provider);
  const plog = (msg) => log(`[ai-review:${provider}] ${msg}`);
  const marker = `<!-- ai-review:${provider}:${mode} -->`;

  mkdirSync(OUT_DIR, { recursive: true });
  const statusFile = join(OUT_DIR, `${provider}-${mode}.status.json`);

  const finish = async ({ status, detail, findings = null, body, extra = {} }) => {
    if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
    plog(`STATUS ${status}${detail ? ` — ${detail}` : ''}`);
    writeFileSync(
      statusFile,
      JSON.stringify(
        {
          provider,
          model,
          mode,
          target: target ?? null,
          status,
          detail: detail ?? '',
          findingsCount: findings ? findings.length : null,
          sha: env.GITHUB_SHA ?? null,
          at: new Date().toISOString(),
          ...extra,
        },
        null,
        2,
      ),
    );
    githubOutputs(env, [
      ['status', status],
      ['detail', detail ?? ''],
    ]);
    githubSummary(env, `### 🤖 ${label} (${mode}) — **${status}**\n\n${detail ?? ''}`);
    const comment = await postStickyComment({ env, fetchImpl, log: plog, print, marker, body });
    return { status, detail: detail ?? '', provider, mode, findings, statusFile, comment };
  };

  const notRunBody = (status, detail) =>
    `## 🤖 ${label} review — **${status}**\n\n${detail}\n\n_This is not a clean review: the model did not look at the change. A human review is still required (AGENTS.md §4)._`;

  if (!target)
    return finish({
      status: 'NOT_RUN',
      detail: 'no input path given',
      body: notRunBody('NOT_RUN', 'no input path given'),
    });

  let input;
  if (mode === 'full') {
    if (!existsSync(target)) {
      const d = `path ${target} does not exist`;
      return finish({ status: 'NOT_RUN', detail: d, body: notRunBody('NOT_RUN', d) });
    }
    input = collectSource(target);
  } else {
    if (!existsSync(target)) {
      const d = `path ${target} does not exist`;
      return finish({ status: 'NOT_RUN', detail: d, body: notRunBody('NOT_RUN', d) });
    }
    input = readFileSync(target, 'utf8');
  }
  if (input.trim() === '') {
    const d =
      mode === 'diff'
        ? 'the diff contains no reviewable code (docs/lockfile-only change)'
        : `no source files under ${target}`;
    return finish({
      status: 'NOTHING_TO_REVIEW',
      detail: d,
      body: `## 🤖 ${label} review — **NOTHING_TO_REVIEW**\n\n${d}. The model was not called.`,
    });
  }

  if (!apiKey) {
    const d = `No API key in GitHub Secrets. Add \`${provider.toUpperCase()}_API_KEY\` (Settings → Secrets and variables → Actions) to enable this reviewer.`;
    return finish({
      status: 'BLOCKED_BY_API_KEY',
      detail: d,
      body: notRunBody('BLOCKED_BY_API_KEY', d),
    });
  }

  let truncated = false;
  if (input.length > MAX_INPUT_CHARS) {
    input = input.slice(0, MAX_INPUT_CHARS);
    truncated = true;
  }

  const system = [
    'You are a senior reviewer for TuTak, a loyalty/payments platform (NestJS, Prisma, PostgreSQL, Next.js, Expo).',
    "Money correctness first: double-entry ledger balance, idempotency, race conditions, maker/checker, tenant isolation (a partner must never read or move another partner's data), authorization on every write route, no silent ledger mutation, exactly one payout path (PartnerSettlementService).",
    mode === 'full'
      ? 'You are auditing a module tree, not a diff. Report defects in the code as it is.'
      : 'Review ONLY what the diff changes.',
    'Answer with a JSON array ONLY (no prose, no markdown fences). Each element: {"severity":"P0|P1|P2|P3","category":"money|security|concurrency|correctness|migration|test-gap|other","file":"path","line":123,"finding":"one sentence","evidence":"why, citing the code","suggestedFix":"minimal fix","confidence":0.0-1.0}.',
    'P0 = money loss or security breach; P1 = wrong money figures or authorization gap under realistic use; P2 = bug without money impact; P3 = nit or missing test. An empty array [] means you found nothing. Do not praise. Do not invent files or lines that are not in the input.',
  ].join(' ');

  const user = [
    mode === 'diff'
      ? `PR title: ${env.PR_TITLE ?? ''}`
      : `Full-module audit of ${target} at ${env.GITHUB_SHA ?? 'HEAD'}`,
    '',
    mode === 'diff' ? `PR description:\n${(env.PR_BODY ?? '').slice(0, 4_000)}` : '',
    truncated ? `(input truncated to ${MAX_INPUT_CHARS} characters)` : '',
    mode === 'diff' ? '```diff' : '```',
    input,
    '```',
  ].join('\n');

  async function ask(attempt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          ...(TEMPERATURE === undefined ? {} : { temperature: TEMPERATURE }),
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        // 4xx other than 429 will not get better on retry.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { fatal: `model answered ${response.status}: ${text}` };
        }
        return { retry: `model answered ${response.status}: ${text}` };
      }
      const json = await response.json();
      return { content: json?.choices?.[0]?.message?.content ?? '', usage: json?.usage ?? null };
    } catch (err) {
      return {
        retry: `model unreachable (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  let result = null;
  let lastError = '';
  for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
    const r = await ask(attempt);
    if (r.fatal) {
      lastError = r.fatal;
      break;
    }
    if (r.retry) {
      lastError = r.retry;
      plog(r.retry);
      if (attempt <= RETRIES) await sleep(5_000 * attempt);
      continue;
    }
    result = r;
    break;
  }
  if (!result)
    return finish({
      status: 'PROVIDER_FAILURE',
      detail: lastError,
      body: notRunBody('PROVIDER_FAILURE', lastError),
    });

  const findings = parseFindings(result.content);
  const outFile = join(OUT_DIR, `${provider}-${mode}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        provider,
        model,
        mode,
        target,
        sha: env.GITHUB_SHA ?? null,
        truncated,
        usage: result.usage,
        status: findings ? 'REVIEW_COMPLETE' : 'INVALID_RESPONSE',
        findings,
        raw: findings ? undefined : String(result.content).slice(0, 20_000),
      },
      null,
      2,
    ),
  );
  plog(`saved ${outFile}`);

  if (findings === null) {
    const d =
      'the model answered, but not with a JSON array of findings (see raw answer in the artifact)';
    return finish({
      status: 'INVALID_RESPONSE',
      detail: d,
      body:
        `## 🤖 ${label} review — **INVALID_RESPONSE**\n\n${d}.\n\n` +
        '_This is not a clean review: the answer could not be parsed, so no finding can be counted or ruled out. A human review is still required (AGENTS.md §4)._\n\n' +
        '<details><summary>raw answer (first 6000 chars)</summary>\n\n```\n' +
        String(result.content).slice(0, 6_000) +
        '\n```\n</details>',
      extra: { truncated, usage: result.usage },
    });
  }

  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let body =
    `## 🤖 ${label} review — **REVIEW_COMPLETE** (advisory, model \`${model}\`, ${mode})\n\n` +
    '_Second opinion, not an approval: every finding must be confirmed by a test or by reading the code before it is acted on (AGENTS.md §4). The model never merges, deploys or marks anything verified._\n\n' +
    (truncated ? `_Input truncated to ${MAX_INPUT_CHARS} characters._\n\n` : '');
  if (findings.length === 0) {
    body += 'No findings reported by the model at any severity.';
  } else {
    const counts = SEVERITIES.map(
      (s) => `${s}: ${findings.filter((f) => f.severity === s).length}`,
    ).join(' · ');
    body += `**${findings.length} finding(s)** — ${counts}\n\n| Sev | Category | File:line | Finding | Fix | Conf |\n|---|---|---|---|---|---|\n`;
    for (const f of [...findings].sort(
      (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
    )) {
      body += `| ${f.severity} | ${esc(f.category)} | \`${esc(f.file)}:${f.line}\` | ${esc(f.finding)}<br/><sub>${esc(f.evidence)}</sub> | ${esc(f.suggestedFix)} | ${f.confidence.toFixed(2)} |\n`;
    }
  }
  if (result.usage) body += `\n\n<sub>tokens: ${JSON.stringify(result.usage)}</sub>`;
  return finish({
    status: 'REVIEW_COMPLETE',
    detail: `${findings.length} finding(s)`,
    findings,
    body,
    extra: { truncated, usage: result.usage },
  });
}

/**
 * Combines per-provider statuses into one verdict.
 * GREEN iff every expected provider is REVIEW_COMPLETE, or every one is
 * NOTHING_TO_REVIEW (same empty input for all). A missing status counts as
 * NOT_RUN. The headline is the most serious non-green status present.
 */
export function computeVerdict(statuses, expectedProviders) {
  const per = expectedProviders.map((p) => {
    const s = statuses.find((x) => x && x.provider === p);
    return {
      provider: p,
      status: s && STATUSES.includes(s.status) ? s.status : 'NOT_RUN',
      detail: s?.detail ?? 'no status file',
      findingsCount: s?.findingsCount ?? null,
    };
  });
  const all = (st) => per.length > 0 && per.every((x) => x.status === st);
  if (all('REVIEW_COMPLETE')) return { green: true, verdict: 'REVIEW_COMPLETE', per };
  if (all('NOTHING_TO_REVIEW')) return { green: true, verdict: 'NOTHING_TO_REVIEW', per };
  const priority = [
    'PROVIDER_FAILURE',
    'INVALID_RESPONSE',
    'BLOCKED_BY_API_KEY',
    'NOT_RUN',
    'NOTHING_TO_REVIEW',
  ];
  const headline = priority.find((st) => per.some((x) => x.status === st)) ?? 'NOT_RUN';
  return { green: false, verdict: headline, per };
}

export function readStatuses(outDir, mode, providers) {
  return providers.map((p) => {
    const f = join(outDir, `${p}-${mode}.status.json`);
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return { provider: p, status: 'NOT_RUN', detail: `unreadable ${f}` };
    }
  });
}

export function renderVerdict(v, mode) {
  const rows = v.per
    .map(
      (x) =>
        `| ${labelOf(x.provider)} | **${x.status}** | ${String(x.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    )
    .join('\n');
  return (
    `## 🤖 AI review verdict (${mode}) — **${v.green ? 'GREEN' : 'NOT GREEN'}: ${v.verdict}**\n\n` +
    `| Model | Status | Detail |\n|---|---|---|\n${rows}\n\n` +
    (v.green
      ? v.verdict === 'REVIEW_COMPLETE'
        ? '_Both models actually reviewed this change. Their findings are advisory (AGENTS.md §4)._'
        : '_The change holds no reviewable code; nothing was sent to a model._'
      : '_GREEN requires REVIEW_COMPLETE from every model. This job is advisory and is not a required check, so it does not block the PR — but it is not a clean review either._')
  );
}

export async function runVerdict({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  log = (msg) => console.log(msg),
  print = (body) => console.log(body),
} = {}) {
  const outDir = argv[1] ?? env.AI_REVIEW_OUT_DIR ?? 'ai-review-out';
  const providers = (argv[2] ?? 'kimi,deepseek')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const mode = env.AI_REVIEW_MODE === 'full' ? 'full' : 'diff';
  const v = computeVerdict(readStatuses(outDir, mode, providers), providers);
  const body = renderVerdict(v, mode);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `verdict-${mode}.json`),
    JSON.stringify({ ...v, sha: env.GITHUB_SHA ?? null, at: new Date().toISOString() }, null, 2),
  );
  githubOutputs(env, [
    ['verdict', v.verdict],
    ['green', v.green ? 'true' : 'false'],
  ]);
  githubSummary(env, body);
  log(
    `[ai-review:verdict] ${v.green ? 'GREEN' : 'NOT GREEN'}: ${v.verdict} — ${v.per.map((x) => `${x.provider}=${x.status}`).join(', ')}`,
  );
  await postStickyComment({
    env,
    fetchImpl,
    log: (m) => log(`[ai-review:verdict] ${m}`),
    print,
    marker: `<!-- ai-review:verdict:${mode} -->`,
    body,
  });
  return { ...v, exitCode: v.green ? 0 : 1 };
}

function isMain() {
  try {
    return (
      process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args[0] === '--verdict') {
    const v = await runVerdict({ argv: args });
    process.exit(v.exitCode);
  } else {
    // A crash here (bug in this script) is the only way to a non-zero exit;
    // provider/input problems are statuses, and the verdict step judges them.
    await runReview({ argv: args });
    process.exit(0);
  }
}
