import { z } from 'zod';

/** Six digits. Not four: 10^4 is guessable inside one lockout cycle. */
export const pinSchema = z.string().regex(/^\d{6}$/, 'PIN must be six digits');

export const setPinSchema = z.object({ pin: pinSchema });
export type SetPinDto = z.infer<typeof setPinSchema>;

export const changePinSchema = z
  .object({ currentPin: pinSchema, newPin: pinSchema })
  .refine((value) => value.currentPin !== value.newPin, { message: 'Choose a different PIN' });
export type ChangePinDto = z.infer<typeof changePinSchema>;

export const authorizationPurposeSchema = z.enum(['WITHDRAWAL', 'AUTO_PAYOUT']);
export type AuthorizationPurpose = z.infer<typeof authorizationPurposeSchema>;

export const authorizationMethodSchema = z.enum(['PIN', 'BIOMETRIC']);
export type AuthorizationMethod = z.infer<typeof authorizationMethodSchema>;

/**
 * Asking the server for a single-use authorization.
 *
 * `BIOMETRIC` does not mean "the app says the face matched". It carries the
 * device secret the server issued at enrolment, which the phone's keystore
 * releases only after the OS biometric check — so what the server verifies is
 * possession of a secret it bound to this device, not a boolean.
 */
export const authorizeSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('PIN'),
    pin: pinSchema,
    purpose: authorizationPurposeSchema.default('WITHDRAWAL'),
    quoteId: z.string().uuid().optional(),
  }),
  z.object({
    method: z.literal('BIOMETRIC'),
    deviceSecret: z.string().min(32).max(128),
    purpose: authorizationPurposeSchema.default('WITHDRAWAL'),
    quoteId: z.string().uuid().optional(),
  }),
]);
export type AuthorizeDto = z.infer<typeof authorizeSchema>;

export const authorizationSchema = z.object({
  authorizationToken: z.string(),
  method: authorizationMethodSchema,
  purpose: authorizationPurposeSchema,
  expiresAt: z.string().datetime(),
});
export type AuthorizationDto = z.infer<typeof authorizationSchema>;

export const enableBiometricSchema = z.object({ pin: pinSchema });
export type EnableBiometricDto = z.infer<typeof enableBiometricSchema>;

export const securityStatusSchema = z.object({
  pinSet: z.boolean(),
  pinLockedUntil: z.string().datetime().nullable(),
  biometricEnabled: z.boolean(),
  /** True when the enrolled device is the one making the request. */
  biometricEnabledOnThisDevice: z.boolean(),
});
export type SecurityStatusDto = z.infer<typeof securityStatusSchema>;
