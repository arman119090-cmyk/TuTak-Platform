import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class RegisterPushTokenDto {
  /** The client's own stable device identifier — the same one login sends. */
  @IsString()
  @Length(1, 200)
  deviceId: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  /**
   * Constrained to Expo's token shape rather than accepting any string.
   * This value is written verbatim into an outbound request to a third
   * party, and a field that accepts anything eventually carries something
   * that is not a push token.
   */
  @IsString()
  @Matches(/^Expo(nent)?PushToken\[[A-Za-z0-9_.-]+\]$/, {
    message: 'pushToken must be an Expo push token',
  })
  pushToken: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  deviceName?: string;
}
