import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PASSWORD_MAX, PASSWORD_MIN } from './password.dto';

/**
 * The API's password bounds and the app's must be the same two numbers.
 *
 * They are written down twice because they have to be: `apps/api`'s `rootDir`
 * forbids importing TypeScript source from outside its own `src`, so this
 * package cannot import `@tutak/shared-types`' constants even though both
 * enforce them. The repository already solves this exact problem the same way
 * for the Sentry sanitiser — keep the copy, and make the build fail when the
 * copies disagree.
 *
 * What drift would cost is not abstract: a form that thinks the maximum is
 * larger than the server does lets the customer type a password that is then
 * refused by the API, and the screen has to explain a rejection it could have
 * prevented. That is how a password-length message ended up being displayed
 * against the SMS code field.
 *
 * Read as text rather than imported, because importing is the thing that is
 * not allowed. Brittle to reformatting on purpose: this should fail loudly if
 * someone moves the declaration, not pass quietly having matched nothing.
 */
describe('password bounds agree with @tutak/shared-types', () => {
  const shared = readFileSync(
    path.resolve(__dirname, '../../../../../../packages/shared-types/src/dto/auth.ts'),
    'utf8',
  );

  const declared = (name: string): number => {
    const match = shared.match(new RegExp(`export const ${name} = (\\d+);`));
    if (!match) {
      throw new Error(
        `${name} is not declared in packages/shared-types/src/dto/auth.ts. If it moved, ` +
          'move this check with it rather than deleting it.',
      );
    }
    return Number(match[1]);
  };

  it('agrees on the minimum', () => {
    expect(PASSWORD_MIN).toBe(declared('PASSWORD_MIN_LENGTH'));
  });

  it('agrees on the maximum', () => {
    expect(PASSWORD_MAX).toBe(declared('PASSWORD_MAX_LENGTH'));
  });
});
