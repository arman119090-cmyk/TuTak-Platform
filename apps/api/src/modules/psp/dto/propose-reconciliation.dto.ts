import { IsString, Length } from 'class-validator';

export class ProposeReconciliationDto {
  /**
   * What the provider's own record shows.
   *
   * Free-form because a portal screenshot reference, a support case id and a
   * statement line are all legitimate, and requiring a shape would mean
   * guessing what the provider gives. Mandatory because "we think it did not
   * go through" with nothing behind it is exactly what this mechanism exists
   * to stop.
   *
   * Note what is *not* here: any field naming the second person. That is the
   * whole point of the two-call shape.
   */
  @IsString()
  @Length(3, 1000)
  evidence: string;
}
