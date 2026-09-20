import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENCRYPTED_COLUMNS } from '../../src/common/crypto/key-rotation.service';

/**
 * Every `*Enc` column in the Prisma schema must be known to the rotation job,
 * or a rotation would silently leave it under the old key.
 */
describe('encrypted columns are all covered by key rotation', () => {
  it('lists every *Enc column in schema.prisma', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const found = new Set<string>();
    let model: string | null = null;
    for (const line of schema.split('\n')) {
      const m = /^model\s+(\w+)\s*\{/.exec(line);
      if (m) {
        model = m[1]!;
        continue;
      }
      if (/^\}/.test(line)) model = null;
      const col = /^\s+(\w+Enc)\s+String/.exec(line);
      if (col && model) found.add(`${model[0]!.toLowerCase()}${model.slice(1)}.${col[1]}`);
    }
    const covered = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.model}.${c.column}`));
    expect([...found].sort()).toEqual([...covered].sort());
    expect(found.size).toBeGreaterThanOrEqual(3);
  });
});
