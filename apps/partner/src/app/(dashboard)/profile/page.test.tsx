import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUserDto, PartnerDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import ProfilePage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * The partner public profile — "about" text plus an optional offerings
 * list, confirmed with Arman 2026-08-23. OWNER-only, no review step
 * (unlike `/branding`) — these tests prove the gate and the two forms.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: {
    get: jest.fn(),
    updateAbout: jest.fn(),
    updateFuelTypes: jest.fn(),
    replaceOfferings: jest.fn(),
  },
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
    locale: 'en',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    ...overrides,
  };
}

function partnerFixture(overrides: Partial<PartnerDto> = {}): PartnerDto {
  return {
    id: 'partner-1',
    displayName: 'SAS Supermarket',
    legalName: 'SAS Supermarket LLC',
    taxId: '00000000',
    category: 'grocery',
    sellsGas: false,
    sellsPetrol: false,
    bonusAccrualRateBps: 300,
    paymentCommissionRateBps: 250,
    isActive: true,
    payoutsBlockedAt: null,
    payoutsBlockedReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logo: null,
    cover: null,
    about: null,
    offerings: [],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

/**
 * `rows.length === 0` — not `loading` — decides whether "Nothing listed
 * yet." shows, so that text is on screen from the very first render, before
 * the fetch resolves. Every test that interacts with the form needs to wait
 * for the fetch itself, not for that text, or it clicks a still-`disabled`
 * "Add item" button against pre-load state.
 */
async function waitForLoaded() {
  await waitFor(() =>
    expect(
      (screen.getByPlaceholderText('We roast our own beans daily…') as HTMLTextAreaElement)
        .disabled,
    ).toBe(false),
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null });
    jest.clearAllMocks();
  });

  it('refuses a non-owner with an explanation, and never fetches the partner', () => {
    useAuthStore.setState({
      user: buildUser({ roles: [Role.PARTNER_STAFF], partnerScopes: { PARTNER_STAFF: ['partner-1'] } }),
    });
    renderPage();

    expect(screen.getByText(/Only the partner owner/)).toBeTruthy();
    expect(partnerApi.get).not.toHaveBeenCalled();
  });

  it("shows nothing pre-written when the partner hasn't set an about text or any offerings", async () => {
    (partnerApi.get as jest.Mock).mockResolvedValue(partnerFixture());
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitFor(() => expect(partnerApi.get).toHaveBeenCalledWith('partner-1'));
    const textarea = (await screen.findByPlaceholderText(
      'We roast our own beans daily…',
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
    expect(screen.getByText('Nothing listed yet.')).toBeTruthy();
  });

  it('seeds the about textarea with the current value and saves an edit', async () => {
    (partnerApi.get as jest.Mock).mockResolvedValue(partnerFixture({ about: 'Existing text' }));
    (partnerApi.updateAbout as jest.Mock).mockResolvedValue(
      partnerFixture({ about: 'Updated text' }),
    );
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    const textarea = (await screen.findByDisplayValue('Existing text')) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated text' } });

    const saveButtons = screen.getAllByText('Save');
    await act(async () => {
      fireEvent.click(saveButtons[0]!);
    });

    await waitFor(() =>
      expect(partnerApi.updateAbout).toHaveBeenCalledWith('partner-1', 'Updated text'),
    );
  });

  it('lets the owner add an offering row and save it', async () => {
    (partnerApi.get as jest.Mock).mockResolvedValue(partnerFixture());
    (partnerApi.replaceOfferings as jest.Mock).mockResolvedValue([
      { id: 'o1', name: 'Espresso', description: null, price: '1500' },
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add item'));

    const nameInput = screen.getByPlaceholderText('Espresso') as HTMLInputElement;
    const priceInput = screen.getByPlaceholderText('1500') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Espresso' } });
    fireEvent.change(priceInput, { target: { value: '1500' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save changes'));
    });

    await waitFor(() =>
      expect(partnerApi.replaceOfferings).toHaveBeenCalledWith('partner-1', [
        { name: 'Espresso', description: undefined, price: '1500' },
      ]),
    );
  });

  it('renders the offerings fetched from the server', async () => {
    (partnerApi.get as jest.Mock).mockResolvedValue(
      partnerFixture({
        offerings: [{ id: 'o1', name: 'Latte', description: 'Oat milk', price: '2000' }],
      }),
    );
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    expect(await screen.findByDisplayValue('Latte')).toBeTruthy();
    expect(screen.getByDisplayValue('Oat milk')).toBeTruthy();
    expect(screen.getByDisplayValue('2000')).toBeTruthy();
  });

  it('blocks saving offerings that are missing a name or a valid price', async () => {
    (partnerApi.get as jest.Mock).mockResolvedValue(partnerFixture());
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add item'));

    expect((screen.getByText('Save changes') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Every item needs a name/)).toBeTruthy();
    expect(partnerApi.replaceOfferings).not.toHaveBeenCalled();
  });
});
