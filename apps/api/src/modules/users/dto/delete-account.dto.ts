import { IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  /**
   * The account's own password, re-entered.
   *
   * The access token is a fifteen-minute bearer credential, so without this a
   * borrowed phone or a leaked token is enough to destroy someone's account
   * and forfeit their points. Re-proving the password is what separates
   * "holds a token" from "is the account owner", and this is the one action
   * on the platform a customer cannot undo alone.
   */
  @IsString()
  @MinLength(1)
  password!: string;
}
