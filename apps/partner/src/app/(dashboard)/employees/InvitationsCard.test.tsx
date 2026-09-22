import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PartnerStaffInvitationStatusDto,
  type PartnerStaffInvitationDto,
} from '@tutak/shared-types';
import { InvitationsCard } from './InvitationsCard';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * The owner's side of an invitation.
 *
 * The thing worth testing here is an absence: the screen must never show a
 * token, because there is no token to show — it goes to the invited phone
 * and is kept only as a hash. An owner who expected a code and does not get
 * one needs to be told why, or they will assume the send failed and press
 * the button again.
 */

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: {
    listInvitations: jest.fn(),
    invite: jest.fn(),
    resendInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
  },
}));

const api = partnerApi as jest.Mocked<typeof partnerApi>;

const invitationFixture = (
  overrides: Partial<PartnerStaffInvitationDto> = {},
): PartnerStaffInvitationDto => ({
  id: 'invitation-1',
  partnerId: 'partner-1',
  phone: '+37491000001',
  role: 'PARTNER_STAFF',
  branchIds: [],
  status: PartnerStaffInvitationStatusDto.PENDING,
  expiresAt: '2026-09-29T00:00:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  ...overrides,
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvitationsCard partnerId="partner-1" branches={[]} />
    </QueryClientProvider>,
  );
}

describe('InvitationsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.listInvitations.mockResolvedValue([]);
  });

  it('says plainly that the code is not shown here, and why', async () => {
    renderCard();

    const note = await screen.findByText(/never shown here/i);
    expect(note.textContent).toMatch(/goes to that phone/i);
    expect(note.textContent).toMatch(/not even to you/i);
  });

  it('sends an invitation for a valid Armenian number', async () => {
    api.invite.mockResolvedValue(invitationFixture());
    renderCard();

    fireEvent.change(screen.getByPlaceholderText('+37491234567'), {
      target: { value: '+37491000001' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Send invitation'));
    });

    await waitFor(() =>
      expect(api.invite).toHaveBeenCalledWith('partner-1', {
        phone: '+37491000001',
        role: 'PARTNER_STAFF',
        branchIds: [],
      }),
    );
  });

  it('will not send to something that is not a phone number', async () => {
    renderCard();
    await screen.findByText('Send invitation');

    fireEvent.change(screen.getByPlaceholderText('+37491234567'), {
      target: { value: '+3749100' },
    });

    expect((screen.getByText('Send invitation') as HTMLButtonElement).disabled).toBe(true);
    expect(api.invite).not.toHaveBeenCalled();
  });

  it('offers cancel and resend only while an invitation is still open', async () => {
    api.listInvitations.mockResolvedValue([
      invitationFixture(),
      invitationFixture({
        id: 'invitation-2',
        phone: '+37491000002',
        status: PartnerStaffInvitationStatusDto.ACCEPTED,
        acceptedAt: '2026-09-22T10:00:00.000Z',
      }),
    ]);
    renderCard();

    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    // One open invitation, so exactly one pair of buttons.
    expect(screen.getAllByText('Cancel')).toHaveLength(1);
    expect(screen.getAllByText('Send again')).toHaveLength(1);
  });

  it('explains that resending kills the old code', async () => {
    renderCard();

    const note = await screen.findByText(/Sending again cancels the old code/i);
    expect(note.textContent).toMatch(/stops working/i);
    // And that cancelling an invitation is not the same as removing access.
    expect(note.textContent).toMatch(/does not remove access/i);
  });

  it('shows the server’s reason when an invitation is refused', async () => {
    api.invite.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        isAxiosError: true,
        response: {
          status: 409,
          data: { message: 'This person already has a role at your organisation' },
        },
      }),
    );
    renderCard();

    fireEvent.change(screen.getByPlaceholderText('+37491234567'), {
      target: { value: '+37491000001' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Send invitation'));
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already has a role/i);
  });
});
