import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUserDto, PartnerBranchDto } from '@tutak/shared-types';
import { PartnerBranchState, Role } from '@tutak/shared-types';
import LocationsPage from './page';
import { useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * Partner self-service branches (spec: product decision, 2026-08-26). OWNER-only, no
 * bulk-replace (unlike `/profile`'s offerings) — a branch is created,
 * edited and deactivated individually because real purchase history
 * references it by id.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: {
    listBranches: jest.fn(),
    createBranch: jest.fn(),
    updateBranch: jest.fn(),
    setBranchState: jest.fn(),
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
    mustChangePassword: false,
    ...overrides,
  };
}

function branchFixture(overrides: Partial<PartnerBranchDto> = {}): PartnerBranchDto {
  return {
    id: 'branch-1',
    partnerId: 'partner-1',
    state: PartnerBranchState.ACTIVE,
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

/** The "Add branch" button starts disabled while the branch list is still loading. */
async function waitForLoaded() {
  await waitFor(() =>
    expect((screen.getByText('Add branch') as HTMLButtonElement).disabled).toBe(false),
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
    expect(await screen.findByText(/No branches yet/)).toBeTruthy();
  });

  it('renders the branches fetched from the server, with their state', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: true, state: PartnerBranchState.ACTIVE }),
      branchFixture({
        id: 'branch-2',
        name: 'Airport',
        isActive: false,
        state: PartnerBranchState.SUSPENDED,
      }),
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    expect(await screen.findByText('Downtown')).toBeTruthy();
    expect(screen.getByText('Airport')).toBeTruthy();
    // "Open" and "Closed for now", not "Active" and "Inactive": the owner's
    // two reasons for shutting a shop imply different next steps.
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Closed for now')).toBeTruthy();
  });

  it('lets the owner add a location with valid coordinates', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    (partnerApi.createBranch as jest.Mock).mockResolvedValue(branchFixture());
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add branch'));

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

  it('accepts a decimal comma and a coordinate pair pasted from a map', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    (partnerApi.createBranch as jest.Mock).mockResolvedValue({});
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add branch'));
    fireEvent.change(screen.getByPlaceholderText('Downtown'), { target: { value: 'Downtown' } });
    fireEvent.change(screen.getByPlaceholderText('1 Republic Square'), {
      target: { value: '1 Republic Square' },
    });
    fireEvent.change(screen.getByPlaceholderText('Yerevan'), { target: { value: 'Yerevan' } });

    // Right-click → copy in Google Maps gives both numbers at once.
    fireEvent.change(screen.getByPlaceholderText('40.1772'), {
      target: { value: '40.177200, 44.512600' },
    });
    expect((screen.getByPlaceholderText('44.5126') as HTMLInputElement).value).toBe('44.512600');

    // A Russian or Armenian keyboard writes the decimal with a comma.
    fireEvent.change(screen.getByPlaceholderText('40.1772'), { target: { value: '40,1772' } });
    expect((screen.getByPlaceholderText('44.5126') as HTMLInputElement).value).toBe('44.512600');

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    await waitFor(() =>
      expect(partnerApi.createBranch).toHaveBeenCalledWith(
        'partner-1',
        expect.objectContaining({ latitude: 40.1772, longitude: 44.5126 }),
      ),
    );
  });

  it('blocks saving a new location with missing or out-of-range coordinates', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await waitForLoaded();
    fireEvent.click(screen.getByText('Add branch'));

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

  it('lets the owner close a location for now, which is not the same as for good', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: true, state: PartnerBranchState.ACTIVE }),
    ]);
    (partnerApi.setBranchState as jest.Mock).mockResolvedValue(
      branchFixture({ isActive: false, state: PartnerBranchState.SUSPENDED }),
    );
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await screen.findByText('Downtown');
    await act(async () => {
      fireEvent.click(screen.getByText('Close for now'));
    });

    await waitFor(() =>
      expect(partnerApi.setBranchState).toHaveBeenCalledWith(
        'partner-1',
        'branch-1',
        PartnerBranchState.SUSPENDED,
      ),
    );
  });

  it('offers to close a location for good, separately', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: true, state: PartnerBranchState.ACTIVE }),
    ]);
    (partnerApi.setBranchState as jest.Mock).mockResolvedValue(
      branchFixture({ isActive: false, state: PartnerBranchState.ARCHIVED }),
    );
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    await screen.findByText('Downtown');
    await act(async () => {
      fireEvent.click(screen.getByText('Close for good'));
    });

    await waitFor(() =>
      expect(partnerApi.setBranchState).toHaveBeenCalledWith(
        'partner-1',
        'branch-1',
        PartnerBranchState.ARCHIVED,
      ),
    );
  });

  /**
   * The question an owner has when shutting a shop is what happens to the
   * sales already made there, so the answer is on the row rather than in a
   * help page somewhere.
   */
  it('says on the row that returns and history carry on', async () => {
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([
      branchFixture({ isActive: false, state: PartnerBranchState.ARCHIVED }),
    ]);
    useAuthStore.setState({ user: buildUser() });
    renderPage();

    expect(await screen.findByText('Closed for good')).toBeTruthy();
    expect(screen.getByText(/Returns and history carry on/)).toBeTruthy();
    // Nothing to archive twice, and reopening is offered instead.
    expect(screen.queryByText('Close for good')).toBeNull();
    expect(screen.getByText('Reopen')).toBeTruthy();
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
