import { IsDateString, IsOptional } from 'class-validator';

/**
 * Bounds the reporting window. The raw query strings previously went straight
 * to `new Date()`, so anything unparseable became an Invalid Date and surfaced
 * as a 500 from Prisma (docs/AUDIT_2026-08-B.md §M18).
 */
export class AnalyticsRangeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
