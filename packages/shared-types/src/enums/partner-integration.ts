/** Spec §3: the extension point for how a partner can accept payment or connect a system. */
export enum PartnerIntegrationType {
  QR_PURCHASE = 'QR_PURCHASE',
  WEBSITE = 'WEBSITE',
  API = 'API',
  POS = 'POS',
  EV_CHARGING = 'EV_CHARGING',
  OCPI = 'OCPI',
}

export enum PartnerIntegrationStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}
