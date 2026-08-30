/**
 * The one phone shape this platform accepts everywhere — was hand-copied
 * into four separate auth DTOs (independent audit, GitHub issue #28) rather
 * than shared, which is exactly how a future format change (an area code,
 * a second country) would end up applied to three of the four call sites.
 */
export const ARMENIAN_PHONE_REGEX = /^\+374\d{8}$/;
export const ARMENIAN_PHONE_MESSAGE = 'phone must be an Armenian number in +374XXXXXXXX format';
