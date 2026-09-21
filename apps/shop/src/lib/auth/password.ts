import { hash, verify, argon2id, type HashOptions } from 'argon2';

/**
 * Argon2id with parameters on the strong side of the OWASP recommendation.
 * Passwords are never stored or logged in any other form.
 */
const OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain: string): Promise<string> => hash(plain, OPTIONS);

export const verifyPassword = async (digest: string, plain: string): Promise<boolean> => {
  try {
    return await verify(digest, plain);
  } catch {
    return false;
  }
};
