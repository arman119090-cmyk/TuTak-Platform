import { IsBoolean } from 'class-validator';

/**
 * Exists so the toggle goes through ValidationPipe at all. `@Body('isActive')`
 * bypasses validation for primitive metatypes, which let `"false"` through as
 * a truthy string and `{}` through as undefined — see docs/AUDIT_2026-08-B.md
 * §M3.
 */
export class SetActiveDto {
  @IsBoolean()
  isActive: boolean;
}
