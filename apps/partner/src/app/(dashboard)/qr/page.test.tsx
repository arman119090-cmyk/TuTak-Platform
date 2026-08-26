import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUserDto, PartnerBranchDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import QrPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { buildPartnerPayQrPayload } from '@/lib/partnerPayQr';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * Mirrors `apps/mobile/src/presentation/utils/partnerPayQr.ts`'s
 * `parsePartnerPayQr` exactly (not imported directly — that file lives in a
 * separate app's TS project). Kept in lockstep with it so this test still
 * proves the encoded payload is something the mobile scanner can parse.
 */
function parsePartnerPayQr(raw: string): { partnerId: string; branchId?: string } | null {
  const PREFIX = 'TUTAK-PAY:';
  if (!raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length).trim();
  if (!rest) return null;
  const [partnerId, branchId] = rest.split(':');
  if (!partnerId) return null;
  return branchId ? { partnerId, branchId } : { partnerId };
}

/**
 * GitHub issue #28 (HIGH, 2026-08-16): this page used to print the
 * TUTAK-PAY: payload as plain text only, despite telling merchants to
 * "print it or display it at the till" — nothing on the page was actually
 * scannable. These tests prove a real QR symbol now renders, carrying the
 * exact same payload as the text fallback, and that a QR-scanning app
 * (`parsePartnerPayQr`, the mobile side) can still parse it.
 *
 * 2026-08-26: a partner with active branches gets one card per branch,
 * each encoding `partnerId:branchId` — see `page.tsx`'s own doc comment.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: { listBranches: jest.fn() },
}));

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
    avatar: null,
    showAvatarInReferralList: false,
    ...overrides,
  };
}

function branchFixture(overrides: Partial<PartnerBranchDto> = {}): PartnerBranchDto {
  return {
    id: 'branch-1',
    partnerId: 'partner-1',
    name: 'Downtown',
    address: '1 Republic Square',
    city: 'Yerevan',
    latitude: 40.177,
    longitude: 44.5126,
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <QrPage />
    </QueryClientProvider>,
  );
}

describe('QrPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null });
    jest.clearAllMocks();
  });

  it('renders the whole-business QR when the partner has no branches', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    const expectedPayload = buildPartnerPayQrPayload('partner-1');
    expect(expectedPayload).toBe('TUTAK-PAY:partner-1');

    const code = await screen.findByTestId('partner-pay-code');
    // The text fallback still shows the payload, unmodified.
    expect(code.textContent).toBe(expectedPayload);

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

  it('renders one card per active branch, each with its own payload', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ id: 'branch-1', name: 'Downtown' }),
      branchFixture({ id: 'branch-2', name: 'Airport' }),
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    expect(await screen.findByText('Downtown')).toBeTruthy();
    expect(screen.getByText('Airport')).toBeTruthy();

    const codes = screen.getAllByTestId('partner-pay-code').map((el) => el.textContent);
    expect(codes).toContain('TUTAK-PAY:partner-1:branch-1');
    expect(codes).toContain('TUTAK-PAY:partner-1:branch-2');

    // Each branch's payload parses back out with the right branch id, and
    // both still resolve to the same partner — one business, several codes.
    expect(parsePartnerPayQr('TUTAK-PAY:partner-1:branch-1')).toEqual({
      partnerId: 'partner-1',
      branchId: 'branch-1',
    });
    expect(parsePartnerPayQr('TUTAK-PAY:partner-1:branch-2')).toEqual({
      partnerId: 'partner-1',
      branchId: 'branch-2',
    });
  });

  it('excludes a deactivated branch, falling back to the whole-business code if none are left active', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: false }),
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitFor(() => expect(partnerApi.listBranches).toHaveBeenCalled());
    const code = await screen.findByTestId('partner-pay-code');
    expect(code.textContent).toBe('TUTAK-PAY:partner-1');
    expect(screen.queryByText('Downtown')).toBeNull();
  });

  it('shows no QR symbol when the account has no linked business', () => {
    useAuthStore.setState({ user: buildUser({ partnerScopes: {} }) });
    renderPage();

    expect(screen.queryByTestId('partner-pay-qr-image')).toBeNull();
    expect(screen.queryByTestId('partner-pay-code')).toBeNull();
    expect(screen.getByText("Your account isn't linked to a business yet.")).not.toBeNull();
    expect(partnerApi.listBranches).not.toHaveBeenCalled();
  });
});
