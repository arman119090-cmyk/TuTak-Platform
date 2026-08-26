import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Partner self-service: declaring what a `fuel`-category station actually
 * sells (Arman, 2026-08-26) — see `Partner.sellsGas`/`sellsPetrol`. Declared
 * locally rather than imported from `@tutak/shared-types`'s
 * `UpdatePartnerFuelTypesRequestDto` — the API's `rootDir` is its own `src`,
 * same rule every other request shape in this module follows.
 *
 * Both optional so a partner can update just one flag without having to
 * resend the other's current value.
 */
export class UpdatePartnerFuelTypesDto {
  @IsOptional()
  @IsBoolean()
  sellsGas?: boolean;

  @IsOptional()
  @IsBoolean()
  sellsPetrol?: boolean;
}
