import { z } from 'zod';
import { localeSchema, phoneSchema } from './common';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  locale: localeSchema.default('hy'),
  /** Stable per-installation id; used for device binding and velocity checks. */
  deviceId: z.string().min(8).max(128),
});
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;

export const requestOtpResponseSchema = z.object({
  /** Opaque handle for the challenge; the code itself never leaves the server. */
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  /** Seconds the client must wait before it may ask for another code. */
  resendAfterSeconds: z.number().int().nonnegative(),
  codeLength: z.number().int().min(4).max(8),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const verifyOtpSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{4,8}$/),
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().max(120).optional(),
  platform: z.enum(['ios', 'android']).optional(),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string(),
  refreshExpiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
  deviceId: z.string().min(8).max(128),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const sessionSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string(),
  deviceName: z.string().nullable(),
  platform: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof sessionSchema>;
