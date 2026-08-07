/**
 * Split out from redis.module.ts on purpose. That file imports
 * DistributedLockService (to register it as a provider) and
 * DistributedLockService imports this token — if the token lived in
 * redis.module.ts too, that would be a circular import between the two
 * files. CommonJS resolves such a cycle by handing the second file a
 * partially-initialized module whose exports aren't assigned yet, so
 * `REDIS_CLIENT` was `undefined` at the exact moment `@Inject(REDIS_CLIENT)`
 * evaluated it — NestJS then reported the decorated parameter as
 * unresolvable, since it had genuinely been decorated with an undefined
 * token. A token with no dependencies of its own can't be party to a cycle.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
