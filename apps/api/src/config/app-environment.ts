/**
 * Which deployment this process is, kept separate from which runtime mode
 * Node is in.
 *
 * `NODE_ENV` used to carry both meanings, and the second one broke things.
 * A deployment that is reachable from the open internet was labelled
 * `staging`, so every guard written as `NODE_ENV === 'production'` — the SMS
 * carrier requirement above all — silently did not apply to it, while
 * `NODE_ENV=staging` also put Express, Nest and half the npm ecosystem into
 * their non-production code paths. One variable cannot answer both "is this
 * exposed to real people" and "should the framework enable its development
 * conveniences", and the answers differ for exactly the deployment where
 * being wrong costs the most.
 *
 * So: `NODE_ENV` is `production` for anything deployed, always, and
 * `APP_ENV` names *which* deployment it is. The two predicates below are
 * what the rest of the codebase should ask, never `NODE_ENV` directly.
 */
export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Resolves `APP_ENV`, falling back to `NODE_ENV` for a deployment that has
 * not been migrated yet.
 *
 * The fallback maps `production` to `production` and anything else to what
 * it says, so a pre-migration process keeps its old behaviour rather than
 * silently becoming something stricter or laxer on the next deploy.
 */
export function resolveAppEnvironment(env: {
  APP_ENV?: string;
  NODE_ENV?: string;
}): AppEnvironment {
  const declared = (env.APP_ENV ?? '').trim().toLowerCase();
  if ((APP_ENVIRONMENTS as readonly string[]).includes(declared)) {
    return declared as AppEnvironment;
  }
  if (declared.length > 0) {
    throw new Error(
      `APP_ENV must be one of ${APP_ENVIRONMENTS.join(', ')} — got "${env.APP_ENV}".`,
    );
  }

  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  return (APP_ENVIRONMENTS as readonly string[]).includes(node)
    ? (node as AppEnvironment)
    : 'development';
}

/**
 * True for any deployment real people can reach: staging and production.
 *
 * Gates everything whose failure mode is "a stranger on the internet gets
 * something they should not" — CORS enforcement, Swagger being off, the
 * refusal to hand out verification codes through a console transport, the
 * requirement that Redis is shared rather than a per-replica localhost.
 * Staging is not a rehearsal for these; it is exposed, so it needs them.
 */
export function isPublicDeployment(appEnv: AppEnvironment): boolean {
  return appEnv === 'staging' || appEnv === 'production';
}

/**
 * True only for production.
 *
 * Gates the *commercial* requirements — a real acquirer, real push
 * credentials, durable object storage — which staging legitimately does not
 * have and must still be able to boot without. Keeping these separate from
 * `isPublicDeployment` is the whole point of the split: staging gets every
 * security control and none of the contracts.
 */
export function isProductionDeployment(appEnv: AppEnvironment): boolean {
  return appEnv === 'production';
}
