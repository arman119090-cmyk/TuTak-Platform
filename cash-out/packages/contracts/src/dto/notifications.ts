import { z } from 'zod';

export const notificationPreferencesSchema = z.object({
  payoutStatus: z.boolean(),
  autoPayout: z.boolean(),
  securityAlerts: z.boolean(),
  parkChanges: z.boolean(),
  /** Whether a push token is registered for this driver; never the token itself. */
  pushRegistered: z.boolean(),
  /** MOCK until a push provider is contracted; the app shows this honestly. */
  deliveryMode: z.enum(['mock', 'live']),
});
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = z.object({
  payoutStatus: z.boolean().optional(),
  autoPayout: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  parkChanges: z.boolean().optional(),
});
export type UpdateNotificationPreferencesDto = z.infer<typeof updateNotificationPreferencesSchema>;

export const registerPushTokenSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.enum(['ios', 'android']),
});
export type RegisterPushTokenDto = z.infer<typeof registerPushTokenSchema>;

/** The categories a notification belongs to; each maps to one preference. */
export const notificationKindSchema = z.enum([
  'PAYOUT_COMPLETED',
  'PAYOUT_CANCELLED',
  'PAYOUT_REJECTED',
  'PAYOUT_UNDER_REVIEW',
  'AUTO_PAYOUT_CREATED',
  'AUTO_PAYOUT_PAUSED',
  'SECURITY_PIN_CHANGED',
  'SECURITY_BIOMETRIC_CHANGED',
  'SECURITY_NEW_DEVICE',
  'PARK_SWITCHED',
  'PARK_ACCESS_CHANGED',
  'DRIVER_ID_DECIDED',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;
