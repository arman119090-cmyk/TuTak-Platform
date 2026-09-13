import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every password box in the app has an eye, and this is what keeps it true.
 *
 * The eye existed on exactly one screen — registration — and the other five
 * boxes had none: sign in, reset, both boxes on change-password, and the one
 * that confirms deleting an account. Nobody decided that; each screen was
 * written on its own and `secureTextEntry` on its own is the easy thing to
 * type. The same omission would happen again on the next screen.
 *
 * So this reads the source rather than rendering anything: a field that hides
 * what is typed must also offer a way to see it. Grepping source is a blunt
 * instrument and deliberate here — the property is "no file does X without Y",
 * which no amount of rendering one screen at a time can establish.
 *
 * On a phone this is not a nicety. A mistyped character is invisible,
 * autocorrect and the letter/number keyboard switch both interfere, and the
 * only feedback is a refusal that reads as "you got your password wrong". The
 * account it matters most for is the administrator's, whose password is
 * generated, unmemorised, and read off another screen.
 */
describe('every password field can be revealed', () => {
  const root = join(__dirname, '..');

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      if (!full.endsWith('.tsx')) return [];
      if (full.endsWith('.test.tsx')) return [];
      return [full];
    });

  it('pairs secureTextEntry with a revealToggle wherever it appears', () => {
    const offenders = sourceFiles(root)
      .filter((file) => !file.endsWith('TextField.tsx'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('secureTextEntry')) return false;
        return !source.includes('revealToggle');
      })
      .map((file) => file.slice(root.length + 1));

    expect(offenders).toEqual([]);
  });

  it('gives each password box its own reveal, not one shared between them', () => {
    // Two boxes sharing a single toggle would reveal a password when the
    // person only meant to check the confirmation they just typed — and on
    // change-password, would show the current password to whoever is looking
    // over their shoulder at the new one.
    const shared = sourceFiles(root)
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => source.includes('revealToggle'))
      .filter(({ source }) => {
        const boxes = source.match(/secureTextEntry=\{/g)?.length ?? 0;
        const reveals = new Set(source.match(/revealToggle=\{([A-Za-z]+)\./g) ?? []).size;
        return boxes > 1 && reveals < boxes;
      })
      .map(({ file }) => file.slice(root.length + 1));

    expect(shared).toEqual([]);
  });
});
