import { IsDateString } from 'class-validator';

export class RequireShiftsFromDto {
  /** ISO-8601 instant; must not be later than the partner's current date. */
  @IsDateString()
  at!: string;
}
