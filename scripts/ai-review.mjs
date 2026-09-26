#!/usr/bin/env node
/**
 * Asks one OpenAI-compatible chat model to review a diff and posts the
 * answer as a sticky PR comment. Used by .github/workflows/ai-review.yml for
 * Kimi (Moonshot) and DeepSeek; both speak the /chat/completions dialect.
 *
 *   AI_REVIEW_PROVIDER=kimi AI_REVIEW_API_KEY=... node scripts/ai-review.mjs pr.diff
 *
 * Exit code is 0 in every case that is not a programming error here: no key
 * (BLOCKED_BY_API_KEY), an empty diff, the model refusing or timing out, the
 * comment failing to post. A review that cannot run must not block a merge —
 * it is advice (AGENTS.md §4) — but it must say so loudly in the job log.
 */
import { readFileSync } from 'node:fs';

const provider = process.env.AI_REVIEW_PROVIDER ?? 'model';
const apiKey = process.env.AI_REVIEW_API_KEY?.trim();
const baseUrl = (process.env.AI_REVIEW_BASE_URL ?? '').replace(/\/$/, '');
const model = process.env.AI_REVIEW_MODEL ?? '';
const diffPath = process.argv[2];
const MAX_DIFF_CHARS = 120_000;

const log = (msg) => console.log(`[ai-review:${provider}] ${msg}`);

if (!apiKey) {
  log('BLOCKED_BY_API_KEY — no API key in secrets; skipping. Add ' +
    `${provider.toUpperCase()}_API_KEY to GitHub → Settings → Secrets → Actions to enable.`);
  process.exit(0);
}
if (!diffPath) {
  log('no diff path given; skipping');
  process.exit(0);
}

let diff = readFileSync(diffPath, 'utf8');
if (diff.trim() === '') {
  log('empty diff; nothing to review');
  process.exit(0);
}
let truncated = false;
if (diff.length > MAX_DIFF_CHARS) {
  diff = diff.slice(0, MAX_DIFF_CHARS);
  truncated = true;
}

const system = [
  'You are a senior reviewer for TuTak, a loyalty/payments platform (NestJS, Prisma, PostgreSQL, Next.js, Expo).',
  'Money correctness comes first: double-entry ledger balance, idempotency, race conditions, maker/checker rules, tenant isolation (a partner must never read or move another partner\'s data), authorization on every write route.',
  'Review ONLY what the diff changes. Report concrete defects with file and line, a failure scenario, and a minimal fix. Then list tests that are missing.',
  'Severity scale: P0 (money loss / security breach), P1 (wrong money figures or authorization gap under realistic use), P2 (bug, no money impact), NIT.',
  'If you find nothing at a given severity, say so explicitly. Do not praise. Be brief and specific. Answer in English.',
].join(' ');

const user = [
  `PR title: ${process.env.PR_TITLE ?? ''}`,
  '',
  'PR description:',
  (process.env.PR_BODY ?? '').slice(0, 4_000),
  '',
  truncated ? `(diff truncated to ${MAX_DIFF_CHARS} characters)` : '',
  '```diff',
  diff,
  '```',
].join('\n');

async function review() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      log(`model answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return null;
    }
    const json = await response.json();
    return json?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    log(`model unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postStickyComment(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const number = process.env.PR_NUMBER;
  if (!token || !repo || !number) {
    log('no GitHub context; printing review instead');
    console.log(body);
    return;
  }
  const marker = `<!-- ai-review:${provider} -->`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const listUrl = `https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100`;
  const existing = await fetch(listUrl, { headers }).then((r) => (r.ok ? r.json() : []));
  const mine = Array.isArray(existing) ? existing.find((c) => typeof c.body === 'string' && c.body.includes(marker)) : null;
  const payload = JSON.stringify({ body: `${marker}\n${body}` });
  const result = mine
    ? await fetch(`https://api.github.com/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', headers, body: payload })
    : await fetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, { method: 'POST', headers, body: payload });
  if (!result.ok) {
    log(`could not post the comment (${result.status}); printing review instead`);
    console.log(body);
  } else {
    log(mine ? 'updated the sticky comment' : 'posted the sticky comment');
  }
}

const content = await review();
if (!content) {
  log('no review produced');
  process.exit(0);
}
const header = `## 🤖 ${provider === 'kimi' ? 'Kimi' : provider === 'deepseek' ? 'DeepSeek' : provider} review (advisory, model \`${model}\`)\n\n` +
  `_Second opinion, not an approval: every finding below must be confirmed by a test or by reading the code before it is acted on (AGENTS.md §4)._` +
  (truncated ? `\n\n_Diff was truncated to ${MAX_DIFF_CHARS} characters._` : '') + '\n\n';
await postStickyComment(header + content);
