import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, SESSION_COOKIE, signInRequest } from '@/lib/api';

/**
 * Operator sign-in.
 *
 * A server action, so the password and the TOTP code are posted to this server
 * and exchanged for a session there; the resulting token is written straight
 * into an httpOnly cookie and never exists in the browser's JavaScript.
 */
async function signIn(formData: FormData): Promise<void> {
  'use server';

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const totpCode = String(formData.get('totpCode') ?? '').trim();

  let token: string;
  let expiresIn: number;
  try {
    const result = await signInRequest(email, password, totpCode || undefined);
    token = result.token;
    expiresIn = result.expiresIn;
  } catch (error) {
    const code = error instanceof AdminApiError ? error.code : 'INTERNAL_ERROR';
    redirect(`/sign-in?error=${encodeURIComponent(code)}`);
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresIn,
  });

  redirect('/');
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="sign-in">
      <form action={signIn} className="card">
        <h1 style={{ marginBottom: 4 }}>Cash Out</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          Operations console
        </p>

        {error ? (
          <div className="error">
            {error === 'RATE_LIMITED'
              ? 'This account is temporarily locked. Try again shortly.'
              : error === 'FORBIDDEN'
                ? 'Two-factor authentication must be set up for this account.'
                : 'Those credentials are not valid.'}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="totpCode">Authenticator code</label>
          <input
            id="totpCode"
            name="totpCode"
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="one-time-code"
            placeholder="123456"
          />
        </div>

        <button type="submit" style={{ width: '100%' }}>
          Sign in
        </button>
      </form>
    </main>
  );
}
