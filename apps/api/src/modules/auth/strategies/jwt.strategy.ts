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
      // Pin the accepted algorithm. With a symmetric string secret the
      // library already refuses `none` and any asymmetric algorithm, so this
      // is defence in depth rather than a fix for a live hole — but it states
      // the one algorithm we sign with explicitly, so no future change to how
      // the secret is sourced can silently widen what a token may be signed
      // with. Access tokens are minted HS256 (see AuthService.issueTokenPair).
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtAccessPayload): Promise<RequestUser> {
    const claims = await this.usersService.buildRequestUserClaims(payload.sub);
    return { ...claims, deviceId: payload.deviceId };
  }
}
