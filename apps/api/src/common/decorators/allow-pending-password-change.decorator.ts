import { SetMetadata } from '@nestjs/common';

export const ALLOWS_PENDING_PASSWORD_CHANGE = 'allowsPendingPasswordChange';

/**
 * Marks the few routes reachable while a forced password rotation is pending.
 * Everything else is refused, so a bootstrap credential can log in and change
 * itself but can never be used to operate the platform.
 */
export const AllowsPendingPasswordChange = () =>
  SetMetadata(ALLOWS_PENDING_PASSWORD_CHANGE, true);
