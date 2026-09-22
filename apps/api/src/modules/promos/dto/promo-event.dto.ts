import { IsIn } from 'class-validator';

export const PROMO_EVENT_TYPES = ['IMPRESSION', 'OPEN'] as const;
export type PromoEventType = (typeof PROMO_EVENT_TYPES)[number];

/** The app reporting that a card was seen, or tapped. Nothing else. */
export class PromoEventDto {
  @IsIn(PROMO_EVENT_TYPES)
  type: PromoEventType;
}
