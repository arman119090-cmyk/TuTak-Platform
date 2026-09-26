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
 *
 * Exit code is 0 in every case that is not a programming error here. A
 * review that cannot run must not block a merge — it is advice — but it must
 * never look like a clean review either: without a key the job says
 * BLOCKED_BY_API_KEY in the log *and* in a PR comment; a provider failure is
 * reported the same way. "No comment" is never "no findings".
 *
 * Findings are requested as JSON matching FINDING_SCHEMA (severity, category,
 * file, line, finding, evidence, suggestedFix, confidence) so a later
 * decision engine can consume them; the human-readable table is rendered
 * from the same objects.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const provider = process.env.AI_REVIEW_PROVIDER ?? 'model';
const apiKey = process.env.AI_REVIEW_API_KEY?.trim();
const baseUrl = (process.env.AI_REVIEW_BASE_URL ?? '').replace(/\/$/, '');
const model = process.env.AI_REVIEW_MODEL ?? '';
const mode = process.env.AI_REVIEW_MODE === 'full' ? 'full' : 'diff';
const target = process.argv[2];
const MAX_INPUT_CHARS = Number(process.env.AI_REVIEW_MAX_INPUT_CHARS ?? 120_000);
const MAX_OUTPUT_TOKENS = Number(process.env.AI_REVIEW_MAX_OUTPUT_TOKENS ?? 4_000);
const TIMEOUT_MS = Number(process.env.AI_REVIEW_TIMEOUT_MS ?? 180_000);
const RETRIES = Number(process.env.AI_REVIEW_RETRIES ?? 2);
const OUT_DIR = process.env.AI_REVIEW_OUT_DIR ?? 'ai-review-out';

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const FINDING_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['severity', 'category', 'file', 'line', 'finding', 'evidence', 'suggestedFix', 'confidence'],
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

const label = provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : provider;
const log = (msg) => console.log(`[ai-review:${provider}] ${msg}`);
const marker = `<!-- ai-review:${provider}:${mode} -->`;

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

async function postStickyComment(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const number = process.env.PR_NUMBER;
  if (!token || !repo || !number) {
    log('no PR context; printing instead');
    console.log(body);
    return;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const list = await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100`, { headers })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const mine = Array.isArray(list) ? list.find((c) => typeof c.body === 'string' && c.body.includes(marker)) : null;
  const payload = JSON.stringify({ body: `${marker}\n${body}` });
  const result = mine
    ? await fetch(`https://api.github.com/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', headers, body: payload }).catch(() => null)
    : await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, { method: 'POST', headers, body: payload }).catch(() => null);
  if (!result || !result.ok) {
    log(`could not post the comment (${result ? result.status : 'network'}); printing instead`);
    console.log(body);
  } else {
    log(mine ? 'updated the sticky comment' : 'posted the sticky comment');
  }
}

const notRun = async (status, detail) => {
  log(`${status} — ${detail}`);
  await postStickyComment(
    `## 🤖 ${label} review — **${status}**\n\n${detail}\n\n_This is not a clean review: the model did not look at the change. A human review is still required (AGENTS.md §4)._`,
  );
  process.exit(0);
};

if (!apiKey) {
  await notRun(
    'BLOCKED_BY_API_KEY',
    `No API key in GitHub Secrets. Add \`${provider.toUpperCase()}_API_KEY\` (Settings → Secrets and variables → Actions) to enable this reviewer.`,
  );
}
if (!target) await notRun('NOT_RUN', 'no input path given');

let input;
if (mode === 'full') {
  if (!existsSync(target)) await notRun('NOT_RUN', `path ${target} does not exist`);
  input = collectSource(target);
} else {
  input = readFileSync(target, 'utf8');
}
if (input.trim() === '') {
  log('empty input; nothing to review');
  process.exit(0);
}
let truncated = false;
if (input.length > MAX_INPUT_CHARS) {
  input = input.slice(0, MAX_INPUT_CHARS);
  truncated = true;
}

const system = [
  'You are a senior reviewer for TuTak, a loyalty/payments platform (NestJS, Prisma, PostgreSQL, Next.js, Expo).',
  'Money correctness first: double-entry ledger balance, idempotency, race conditions, maker/checker, tenant isolation (a partner must never read or move another partner\'s data), authorization on every write route, no silent ledger mutation, exactly one payout path (PartnerSettlementService).',
  mode === 'full'
    ? 'You are auditing a module tree, not a diff. Report defects in the code as it is.'
    : 'Review ONLY what the diff changes.',
  'Answer with a JSON array ONLY (no prose, no markdown fences). Each element: {"severity":"P0|P1|P2|P3","category":"money|security|concurrency|correctness|migration|test-gap|other","file":"path","line":123,"finding":"one sentence","evidence":"why, citing the code","suggestedFix":"minimal fix","confidence":0.0-1.0}.',
  'P0 = money loss or security breach; P1 = wrong money figures or authorization gap under realistic use; P2 = bug without money impact; P3 = nit or missing test. An empty array [] means you found nothing. Do not praise. Do not invent files or lines that are not in the input.',
].join(' ');

const user = [
  mode === 'diff' ? `PR title: ${process.env.PR_TITLE ?? ''}` : `Full-module audit of ${target} at ${process.env.GITHUB_SHA ?? 'HEAD'}`,
  '',
  mode === 'diff' ? `PR description:\n${(process.env.PR_BODY ?? '').slice(0, 4_000)}` : '',
  truncated ? `(input truncated to ${MAX_INPUT_CHARS} characters)` : '',
  mode === 'diff' ? '```diff' : '```',
  input,
  '```',
].join('\n');

async function ask(attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
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
    return { retry: `model unreachable (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function parseFindings(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({
        severity: SEVERITIES.includes(f.severity) ? f.severity : 'P3',
        category: String(f.category ?? 'other'),
        file: String(f.file ?? ''),
        line: Number.isInteger(f.line) ? f.line : 0,
        finding: String(f.finding ?? ''),
        evidence: String(f.evidence ?? ''),
        suggestedFix: String(f.suggestedFix ?? ''),
        confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0,
      }));
  } catch {
    return null;
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
    log(r.retry);
    await new Promise((res) => setTimeout(res, 5_000 * attempt));
    continue;
  }
  result = r;
  break;
}
if (!result) await notRun('PROVIDER_FAILURE', lastError);

const findings = parseFindings(result.content);
mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `${provider}-${mode}.json`);
writeFileSync(
  outFile,
  JSON.stringify(
    { provider, model, mode, target, sha: process.env.GITHUB_SHA ?? null, truncated, usage: result.usage, findings, raw: findings ? undefined : result.content },
    null,
    2,
  ),
);
log(`saved ${outFile}`);

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
let body = `## 🤖 ${label} review (advisory, model \`${model}\`, ${mode})\n\n` +
  '_Second opinion, not an approval: every finding must be confirmed by a test or by reading the code before it is acted on (AGENTS.md §4). The model never merges, deploys or marks anything verified._\n\n' +
  (truncated ? `_Input truncated to ${MAX_INPUT_CHARS} characters._\n\n` : '');
if (findings === null) {
  body += '**The model did not answer in the requested JSON shape; raw answer below.**\n\n' + result.content.slice(0, 6_000);
} else if (findings.length === 0) {
  body += 'No findings reported by the model at any severity.';
} else {
  const counts = SEVERITIES.map((s) => `${s}: ${findings.filter((f) => f.severity === s).length}`).join(' · ');
  body += `**${findings.length} finding(s)** — ${counts}\n\n| Sev | Category | File:line | Finding | Fix | Conf |\n|---|---|---|---|---|---|\n`;
  for (const f of findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))) {
    body += `| ${f.severity} | ${esc(f.category)} | \`${esc(f.file)}:${f.line}\` | ${esc(f.finding)}<br/><sub>${esc(f.evidence)}</sub> | ${esc(f.suggestedFix)} | ${f.confidence.toFixed(2)} |\n`;
  }
}
if (result.usage) body += `\n\n<sub>tokens: ${JSON.stringify(result.usage)}</sub>`;
await postStickyComment(body);
