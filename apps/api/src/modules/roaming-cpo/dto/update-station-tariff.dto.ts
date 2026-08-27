import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

/**
 * Admin/partner edit of a roaming-CPO station's *display* tariff. Never
 * touches a completed session's own frozen `stationRetailRatePerKwh`
 * snapshot — see `EvStation.standardRetailRatePerKwh`'s docblock for the
 * immutability guarantee this relies on.
 */
export class UpdateStationTariffDto {
  @IsMoneyString({ allowZero: false })
  standardRetailRatePerKwh: string;
}
