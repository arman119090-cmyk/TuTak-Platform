import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUserDto, PartnerBranchDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import LocationsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * Partner self-service branches (spec: Arman, 2026-08-26). OWNER-only, no
 * bulk-replace (unlike `/profile`'s offerings) — a branch is created,
 * edited and deactivated individually because real purchase history
 * references it by id.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: {
    listBranches: jest.fn(),
    createBranch: jest.fn(),
    updateBranch: jest.fn(),
    setBranchActive: jest.fn(),
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

/** The "Add location" button starts disabled while the branch list is still loading. */
async function waitForLoaded() {
  await waitFor(() =>
    expect((screen.getByText('Add location') as HTMLButtonElement).disabled).toBe(false),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LocationsPage />
    </QueryClientProvider>,
  );
}

describe('LocationsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null });
    jest.clearAllMocks();
  });

  it('refuses a non-owner with an explanation, and never fetches branches', () => {
    useAuthStore.setState({
      user: buildUser({ roles: [Role.PARTNER_STAFF], partnerScopes: { PARTNER_STAFF: ['partner-1'] } }),
    });
    renderPage();

    expect(screen.getByText(/Only the partner owner/)).toBeTruthy();
    expect(partnerApi.listBranches).not.toHaveBeenCalled();
  });

  it('shows an empty state until a branch exists', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitFor(() => expect(partnerApi.listBranches).toHaveBeenCalledWith('partner-1'));
    expect(await screen.findByText(/No locations yet/)).toBeTruthy();
  });

  it('renders the branches fetched from the server, with their status', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: true }),
      branchFixture({ id: 'branch-2', name: 'Airport', isActive: false }),
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    expect(await screen.findByText('Downtown')).toBeTruthy();
    expect(screen.getByText('Airport')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('lets the owner add a location with valid coordinates', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    (partnerApi.createBranch as jest.Mock).mockResolvedValue(branchFixture());
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add location'));

    fireEvent.change(screen.getByPlaceholderText('Downtown'), { target: { value: 'Downtown' } });
    fireEvent.change(screen.getByPlaceholderText('1 Republic Square'), {
      target: { value: '1 Republic Square' },
    });
    fireEvent.change(screen.getByPlaceholderText('Yerevan'), { target: { value: 'Yerevan' } });
    fireEvent.change(screen.getByPlaceholderText('40.1772'), { target: { value: '40.177' } });
    fireEvent.change(screen.getByPlaceholderText('44.5126'), { target: { value: '44.5126' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(partnerApi.createBranch).toHaveBeenCalledWith('partner-1', {
        name: 'Downtown',
        address: '1 Republic Square',
        city: 'Yerevan',
        latitude: 40.177,
        longitude: 44.5126,
      }),
    );
  });

  it('blocks saving a new location with missing or out-of-range coordinates', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add location'));

    fireEvent.change(screen.getByPlaceholderText('Downtown'), { target: { value: 'Downtown' } });
    fireEvent.change(screen.getByPlaceholderText('1 Republic Square'), {
      target: { value: '1 Republic Square' },
    });
    fireEvent.change(screen.getByPlaceholderText('Yerevan'), { target: { value: 'Yerevan' } });
    fireEvent.change(screen.getByPlaceholderText('40.1772'), { target: { value: '999' } });
    fireEvent.change(screen.getByPlaceholderText('44.5126'), { target: { value: '44.5126' } });

    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    expect(partnerApi.createBranch).not.toHaveBeenCalled();
  });

  it('lets the owner deactivate an active branch', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([branchFixture({ isActive: true })]);
    (partnerApi.setBranchActive as jest.Mock).mockResolvedValue(branchFixture({ isActive: false }));
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await screen.findByText('Downtown');
    await act(async () => {
      fireEvent.click(screen.getByText('Deactivate'));
    });

    await waitFor(() =>
      expect(partnerApi.setBranchActive).toHaveBeenCalledWith('partner-1', 'branch-1', false),
    );
  });

  it('lets the owner edit an existing branch', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([branchFixture()]);
    (partnerApi.updateBranch as jest.Mock).mockResolvedValue(
      branchFixture({ name: 'Downtown (renamed)' }),
    );
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await screen.findByText('Downtown');
    fireEvent.click(screen.getByText('Edit'));

    const nameInput = screen.getByDisplayValue('Downtown') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Downtown (renamed)' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    await waitFor(() =>
      expect(partnerApi.updateBranch).toHaveBeenCalledWith('partner-1', 'branch-1', {
        name: 'Downtown (renamed)',
        address: '1 Republic Square',
        city: 'Yerevan',
        latitude: 40.177,
        longitude: 44.5126,
      }),
    );
  });
});
