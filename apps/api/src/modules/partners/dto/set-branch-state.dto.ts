import { IsEnum } from 'class-validator';
import { PartnerBranchState } from '@prisma/client';

/**
 * The owner opening a location, shutting it for now, or closing it for good.
 *
 * Separate from the older `isActive` switch on purpose: archiving is a
 * deliberate act, and a boolean is too easy a way to perform one by accident.
 */
export class SetBranchStateDto {
  @IsEnum(PartnerBranchState)
  state: PartnerBranchState;
}
