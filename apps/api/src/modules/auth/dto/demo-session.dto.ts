import { IsString, Length } from 'class-validator';

/**
 * The only thing a demo sign-in needs from the caller.
 *
 * The device id is not decoration: sessions are issued per device, refresh
 * tokens rotate per device, and "log out everywhere" works by device. A demo
 * session that skipped it would be the one session in the system that behaves
 * differently, which is exactly what a demonstration should not contain.
 */
export class DemoSessionDto {
  @IsString()
  @Length(4, 128)
  deviceId!: string;
}
