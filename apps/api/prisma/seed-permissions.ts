/**
 * Kept as a re-export so `prisma/` and the integration suite keep their
 * existing import path. The map itself lives under `src/` because the
 * baseline seeder is compiled into `dist/` and shipped in the runtime
 * image, and TypeScript will not emit a file that sits outside `rootDir`.
 */
export { ROLE_PERMISSIONS } from '../src/scripts/role-permissions';
