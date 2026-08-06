import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * Omitted by browser clients, which present the httpOnly cookie instead.
   * Native clients keep sending it — SecureStore is already out of reach of
   * page script and there is no cookie jar to rely on.
   */
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsString()
  deviceId: string;
}
