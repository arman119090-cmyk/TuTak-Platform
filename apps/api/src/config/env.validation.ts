import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  /**
   * Launch-readiness audit (2026-08-16): `docs/DEPLOYMENT.md` §1 recommends
   * running staging as `development`, since staging legitimately has no real
   * SMS carrier/acquirer/Redis and should not be blocked booting by the
   * same guards `production` needs for those. But `development` also turns
   * off two things that have nothing to do with commercial credentials and
   * everything to do with a server real traffic can reach: the
   * CORS-must-be-configured boot guard (`main.ts`) and disabling the
   * Swagger UI, which then exposes the entire API surface at `/docs` to
   * whoever finds a staging URL. A real `Staging` value lets those two stay
   * on without also demanding a live carrier/acquirer contract just to boot
   * a rehearsal environment.
   */
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @IsOptional()
  PORT: number = 4000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }
  return validatedConfig;
}
