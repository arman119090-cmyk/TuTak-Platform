'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell, Button, Field, Input } from '@tutak/design/web';
import { passwordApi } from '@/lib/api/passwordApi';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * The screen the admin dashboard did not have, and could not work without.
 *
 * A seeded administrator — and any account an admin resets — is created with
 * `mustChangePassword`. `PasswordRotationGuard` then refuses every endpoint
 * except this one. The dashboard offered no way to call it: the operator
 * signed in successfully, every screen answered 403, and nothing on the
 * screen said why or what to do. From outside it looked like a broken
 * deployment; it was a locked door with no handle on the inside.
 *
 * Deliberately its own route rather than a modal: `AuthGate` sends people
 * here, and a person who lands on an address they can read and return to is
 * less lost than one trapped behind a dialog.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, clear } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const forced = user?.mustChangePassword === true;
  const mismatch = confirmation.length > 0 && newPassword !== confirmation;
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmation && !loading;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await passwordApi.change(currentPassword, newPassword);
      // The flag lives on the session the API issued, and it is now stale.
      // Signing out is the honest way to get a fresh one: the next sign-in
      // returns an account that is no longer under rotation.
      clear();
      router.replace('/login');
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 401) setError('That is not the current password.');
      else if (status === 400) setError('The new password does not meet the requirements.');
      else if (status === 429) setError('Too many attempts. Wait a minute and try again.');
      else setError('Could not change the password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={forced ? 'Change your password to continue' : 'Change your password'}
      description={
        forced
          ? 'This account was created with a temporary password, so nothing else will open until it is replaced.'
          : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label="Repeat the new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        {mismatch ? <p className="text-[13px] text-danger-text">The two do not match.</p> : null}
        {newPassword.length > 0 && newPassword.length < 8 ? (
          <p className="text-[13px] text-muted">At least 8 characters.</p>
        ) : null}
        {error ? <p className="text-[13px] text-danger-text">{error}</p> : null}
        <Button type="submit" loading={loading} disabled={!canSubmit}>
          Change password
        </Button>
      </form>
    </AuthShell>
  );
}
