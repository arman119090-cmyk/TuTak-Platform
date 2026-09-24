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
    // Owner's number (Armenia, +374 33 228 733), confirmed 24.09 for
    // WhatsApp, Viber and Telegram. Messaging only: no call link is offered.
    phone: '+374 33 228 733' as string | null,
    whatsapp: '+374 33 228 733' as string | null,
    address: null as string | null,
  },

  social: {
    // The handle levani__art is the account the owner's own screenshots
    // (and the logo source) come from.
    instagram: 'https://instagram.com/levani__art' as string | null, // = enquiry.instagramUrl
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

/**
 * How visitors reach the owner.
 *
 * The site is static, so an online form needs an external endpoint that
 * accepts a JSON POST (Formspree, a CRM inbound hook, a serverless function…).
 * Set NEXT_PUBLIC_ENQUIRY_ENDPOINT at build time to switch the form on.
 * Without it, "enquire" actions lead to the owner's messengers (WhatsApp,
 * Viber, Telegram — one number), with Instagram as a secondary channel, and
 * no form pretends to send anything.
 */
export const enquiry = {
  endpoint: process.env.NEXT_PUBLIC_ENQUIRY_ENDPOINT || null,
  /** Main channel: one number on WhatsApp, Viber and Telegram. */
  messengers: {
    display: '+374 33 228 733',
    whatsapp: (text?: string) =>
      `https://wa.me/37433228733${text ? `?text=${encodeURIComponent(text)}` : ''}`,
    viber: 'viber://chat?number=%2B37433228733',
    telegram: 'https://t.me/+37433228733',
  },
  instagramHandle: 'levani__art',
  instagramUrl: 'https://instagram.com/levani__art',
};

export type AudienceKey = keyof typeof site.audiences;
export type AdvisoryKey = keyof typeof site.advisory;
