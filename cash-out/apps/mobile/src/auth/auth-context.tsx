import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthTokens, DriverProfileDto } from '@cashout/contracts';
import { ApiClient } from '../api/client';
import { tokenStore } from './session';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  profile: DriverProfileDto | null;
  api: ApiClient;
  deviceId: string;
  signIn: (tokens: AuthTokens) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<DriverProfileDto | null>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<DriverProfileDto | null>(null);
  const [deviceId, setDeviceId] = useState('');

  const api = useMemo(
    () => new ApiClient(tokenStore, () => {
      setStatus('signedOut');
      setProfile(null);
    }),
    [],
  );

  const refreshProfile = useCallback(async () => {
    try {
      const next = await api.request<DriverProfileDto>('/v1/me');
      setProfile(next);
      setStatus('signedIn');
      return next;
    } catch {
      return null;
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      setDeviceId(await tokenStore.getDeviceId());
      const token = await tokenStore.getAccessToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      const loaded = await refreshProfile();
      if (!loaded) setStatus('signedOut');
    })();
  }, [refreshProfile]);

  const signIn = useCallback(
    async (tokens: AuthTokens) => {
      await tokenStore.save(tokens);
      await refreshProfile();
    },
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    try {
      await api.request('/v1/auth/sign-out', { method: 'POST' });
    } catch {
      // Signing out locally must work even with no connection.
    }
    await tokenStore.clear();
    setProfile(null);
    setStatus('signedOut');
  }, [api]);

  return (
    <AuthContext.Provider
      value={{ status, profile, api, deviceId, signIn, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}
