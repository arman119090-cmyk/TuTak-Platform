import { z } from 'zod';

/** A Yandex contractor profile id as the driver types it. */
export const externalDriverIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, dashes and underscores only');

export const requestDriverIdChangeSchema = z.object({
  newDriverId: externalDriverIdSchema,
});
export type RequestDriverIdChangeDto = z.infer<typeof requestDriverIdChangeSchema>;

export const driverIdChangeStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export type DriverIdChangeStatus = z.infer<typeof driverIdChangeStatusSchema>;

export const driverIdChangeRequestSchema = z.object({
  id: z.string().uuid(),
  park: z.object({ id: z.string().uuid(), name: z.string() }),
  previousDriverId: z.string(),
  requestedDriverId: z.string(),
  status: driverIdChangeStatusSchema,
  source: z.enum(['DRIVER', 'ADMIN']),
  requestedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().nullable(),
  decidedAt: z.string().datetime().nullable(),
  /** What the automatic check found, in machine form; the app translates it. */
  verificationNote: z.string().nullable(),
  decisionReason: z.string().nullable(),
});
export type DriverIdChangeRequestDto = z.infer<typeof driverIdChangeRequestSchema>;

export const driverIdStateSchema = z.object({
  /** The active membership's Driver ID and park; null when no park is active. */
  current: z
    .object({
      driverId: z.string(),
      park: z.object({ id: z.string().uuid(), name: z.string() }),
    })
    .nullable(),
  pending: driverIdChangeRequestSchema.nullable(),
  history: z.array(driverIdChangeRequestSchema),
});
export type DriverIdStateDto = z.infer<typeof driverIdStateSchema>;

export const decideDriverIdChangeSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type DecideDriverIdChangeDto = z.infer<typeof decideDriverIdChangeSchema>;
