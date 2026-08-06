import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../../config/configuration';
import { UsersService } from '../../users/users.service';
import { RequestUser } from '../types/request-user.type';

export interface JwtAccessPayload {
  sub: string;
  phone: string;
  deviceId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<RequestUser> {
    const claims = await this.usersService.buildRequestUserClaims(payload.sub);
    return { ...claims, deviceId: payload.deviceId };
  }
}
