/**
 * Business facts and switches. Everything here is either confirmed by the
 * owner or `null`. A null contact renders as nothing (or as a neutral
 * "details to follow" line); nothing is invented.
 */
export const site = {
  brandName: 'LEVANI ART',
  tagline: 'ART · ELEGANCE · DECOR',

  contact: {
    email: null as string | null,
    phone: null as string | null,
    whatsapp: null as string | null,
    address: null as string | null,
  },

  social: {
    // The source screenshots show the handle levani__art. The profile URL is
    // left off until the owner confirms it is the account to link.
    instagram: null as string | null,
    facebook: null as string | null,
  },

  company: {
    foundedYear: null as number | null,
    legalName: null as string | null,
    registrationNumber: null as string | null,
  },

  /**
   * Private-client audiences. These are invitations to enquire, not claims
   * of operating services; each can be switched off.
   */
  audiences: {
    collectors: true,
    designers: true,
    architects: true,
    hospitality: true,
    developers: true,
  },

  /**
   * Art-advisory services. Off until the owner confirms each one is actually
   * offered — the page shows only enabled entries and hides the section when
   * none are.
   */
  advisory: {
    sourcing: false,
    placement: false,
    acquisition: false,
    largeScale: false,
    exterior: false,
    delivery: false,
    international: false,
  },
} as const;

export type AudienceKey = keyof typeof site.audiences;
export type AdvisoryKey = keyof typeof site.advisory;
