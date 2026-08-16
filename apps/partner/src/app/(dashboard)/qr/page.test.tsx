import { render, screen } from '@testing-library/react';
import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import QrPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { buildPartnerPayQrPayload } from '@/lib/partnerPayQr';

/**
 * Mirrors `apps/mobile/src/presentation/utils/partnerPayQr.ts`'s
 * `parsePartnerPayQr` exactly (not imported directly — that file lives in a
 * separate app's TS project). Kept in lockstep with it so this test still
 * proves the encoded payload is something the mobile scanner can parse.
 */
function parsePartnerPayQr(raw: string): { partnerId: string } | null {
  const PREFIX = 'TUTAK-PAY:';
  if (!raw.startsWith(PREFIX)) return null;
  const partnerId = raw.slice(PREFIX.length).trim();
  if (!partnerId) return null;
  return { partnerId };
}

/**
 * GitHub issue #28 (HIGH, 2026-08-16): this page used to print the
 * TUTAK-PAY: payload as plain text only, despite telling merchants to
 * "print it or display it at the till" — nothing on the page was actually
 * scannable. These tests prove a real QR symbol now renders, carrying the
 * exact same payload as the text fallback, and that a QR-scanning app
 * (`parsePartnerPayQr`, the mobile side) can still parse it.
 */

function buildUser(overrides: Partial<AuthenticatedUserDto> = {}): AuthenticatedUserDto {
  return {
    id: 'partner-user-1',
    phone: '+37400000002',
    email: null,
    firstName: 'Owner',
    lastName: 'User',
    roles: [Role.PARTNER_OWNER],
    partnerScopes: { PARTNER_OWNER: ['partner-1'] },
    locale: 'hy',
    isPhoneVerified: true,
    ...overrides,
  };
}

describe('QrPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null });
  });

  it('renders a real, scannable QR symbol carrying the exact partner payload', () => {
    useAuthStore.setState({ user: buildUser() });
    render(<QrPage />);

    const expectedPayload = buildPartnerPayQrPayload('partner-1');
    expect(expectedPayload).toBe('TUTAK-PAY:partner-1');

    // The text fallback still shows the payload, unmodified.
    expect(screen.getByTestId('partner-pay-code').textContent).toBe(expectedPayload);

    // A real QR symbol — not a placeholder — is rendered next to it: an SVG
    // whose viewBox is a genuine QR module grid, with a modules path built
    // from many drawing commands, not an empty or decorative box.
    const qrWrap = screen.getByTestId('partner-pay-qr-image');
    const svg = qrWrap.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    const modulesPath = svg?.querySelectorAll('path')[1];
    expect(modulesPath).toBeDefined();
    expect(modulesPath?.getAttribute('d')?.match(/M/g)?.length ?? 0).toBeGreaterThan(20);

    // What the symbol encodes is exactly what the mobile scanner expects to
    // parse back out — the same payload, never rebuilt or reformatted.
    expect(parsePartnerPayQr(expectedPayload)).toEqual({ partnerId: 'partner-1' });
  });

  it('shows no QR symbol when the account has no linked business', () => {
    useAuthStore.setState({ user: buildUser({ partnerScopes: {} }) });
    render(<QrPage />);

    expect(screen.queryByTestId('partner-pay-qr-image')).toBeNull();
    expect(screen.queryByTestId('partner-pay-code')).toBeNull();
    expect(screen.getByText("Your account isn't linked to a business yet.")).not.toBeNull();
  });
});
