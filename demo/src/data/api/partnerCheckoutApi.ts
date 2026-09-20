import type {
  ClaimPartnerCheckoutRequestDto,
  PartnerCheckoutResolveDto,
  PurchaseIntentDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

/** A till-opened purchase, scanned as a dynamic QR (`tutak://checkout/<token>`). */
export const partnerCheckoutApi = {
  async resolve(token: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerCheckoutResolveDto>>(
      `/partner-checkouts/resolve/${encodeURIComponent(token)}`,
    );
    return data.data;
  },

  /** Takes the till's sale as this customer's purchase; the gross is the till's, the funding is theirs. */
  async claim(token: string, dto: ClaimPartnerCheckoutRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PurchaseIntentDto>>(
      `/partner-checkouts/claim/${encodeURIComponent(token)}`,
      dto,
    );
    return data.data;
  },
};
