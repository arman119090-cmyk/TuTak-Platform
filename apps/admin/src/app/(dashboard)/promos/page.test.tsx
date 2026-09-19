import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PartnerPromoAdminDto } from '@tutak/shared-types';
import PromosPage, { statusOf } from './page';
import { promosApi } from '@/lib/api/promosApi';
import { partnersApi } from '@/lib/api/partnersApi';

/**
 * The page's one job beyond CRUD is to say *why* a card is not on
 * customers' screens. Those words are asserted here; the CRUD is asserted
 * only as far as the payload the API receives, which is where a wrong
 * field name or a local-time date would otherwise surface — on a phone.
 */

jest.mock('@/lib/api/promosApi', () => ({
  promosApi: { list: jest.fn(), create: jest.fn(), update: jest.fn(), setArtwork: jest.fn() },
}));
jest.mock('@/lib/api/partnersApi', () => ({
  partnersApi: { list: jest.fn() },
}));

function promo(overrides: Partial<PartnerPromoAdminDto> = {}): PartnerPromoAdminDto {
  return {
    id: 'promo-1',
    partnerId: 'partner-1',
    partnerName: 'Coffee House',
    partnerLogo: null,
    title: 'Coffee to go',
    subtitle: null,
    benefitLabel: '10% cashback',
    artwork: null,
    destination: 'PARTNER',
    sponsored: false,
    active: true,
    priority: 5,
    startAt: null,
    endAt: null,
    live: true,
    impressionCount: 12,
    openCount: 3,
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    ...overrides,
  };
}

let activeUnmount: (() => void) | undefined;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <QueryClientProvider client={client}>
      <PromosPage />
    </QueryClientProvider>,
  );
  activeUnmount = result.unmount;
  return result;
}

describe('statusOf', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  it('names the reason a card is not live', () => {
    expect(statusOf(promo({ live: true }), now).label).toBe('Live');
    expect(statusOf(promo({ live: false, active: false }), now).label).toBe('Off');
    expect(statusOf(promo({ live: false, startAt: '2026-09-20T00:00:00Z' }), now).label).toBe('Scheduled');
    expect(statusOf(promo({ live: false, endAt: '2026-09-18T00:00:00Z' }), now).label).toBe('Expired');
    expect(statusOf(promo({ live: false }), now).label).toBe('Partner not trading');
  });
});

describe('PromosPage', () => {
  beforeEach(() => {
    (promosApi.list as jest.Mock).mockResolvedValue([
      promo(),
      promo({ id: 'promo-2', title: 'Old offer', live: false, endAt: '2026-01-01T00:00:00.000Z', impressionCount: 0, openCount: 0 }),
    ]);
    (promosApi.create as jest.Mock).mockResolvedValue(promo({ id: 'promo-3' }));
    (promosApi.update as jest.Mock).mockResolvedValue(promo({ active: false, live: false }));
    (partnersApi.list as jest.Mock).mockResolvedValue([
      { id: 'partner-1', displayName: 'Coffee House', isActive: true, status: 'ACTIVE' },
      { id: 'partner-2', displayName: 'Pending Shop', isActive: true, status: 'PENDING_APPROVAL' },
    ]);
  });

  afterEach(() => {
    activeUnmount?.();
    activeUnmount = undefined;
    jest.clearAllMocks();
  });

  it('lists every placement with its live state and counters', async () => {
    renderPage();
    expect(await screen.findByText('Coffee to go')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('12 / 3')).toBeTruthy();
  });

  it('creates a placement with the fields the API expects, offering only trading partners', async () => {
    renderPage();
    await screen.findByText('Coffee to go');
    fireEvent.click(screen.getByText('New placement'));

    const partnerSelect = screen.getByLabelText(/^Partner$/) as HTMLSelectElement;
    expect(Array.from(partnerSelect.options).map((o) => o.textContent)).toEqual([
      'Choose a partner…',
      'Coffee House',
    ]);

    fireEvent.change(partnerSelect, { target: { value: 'partner-1' } });
    fireEvent.change(screen.getByLabelText(/^Benefit/), { target: { value: ' −15% ' } });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Night charging' } });
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByText('Create placement'));

    await waitFor(() => expect(promosApi.create).toHaveBeenCalledTimes(1));
    expect((promosApi.create as jest.Mock).mock.calls[0][0]).toEqual({
      partnerId: 'partner-1',
      title: 'Night charging',
      subtitle: null,
      benefitLabel: '−15%',
      destination: 'PARTNER',
      sponsored: false,
      active: true,
      priority: 0,
      startAt: null,
      endAt: null,
    });
  });

  it('switches a placement off with a single field', async () => {
    renderPage();
    await screen.findByText('Coffee to go');
    fireEvent.click(screen.getAllByText('Switch off')[0]!);
    await waitFor(() => expect(promosApi.update).toHaveBeenCalledWith('promo-1', { active: false }));
  });
});
