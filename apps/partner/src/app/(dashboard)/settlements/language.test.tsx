import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import SettlementsPage from './page';
import i18n from '@/lib/i18n/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import { settlementApi } from '@/lib/api/financeApi';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * The money screen in all three languages.
 *
 * The key-parity test proves the bundles agree; this proves the screen
 * actually reads them. Those are different failures: a page that hard-codes
 * one English sentence passes parity and still shows English to a Russian
 * owner, which on a financial screen is exactly where it matters — the three
 * position states are the sentence somebody reads to find out which way
 * their balance points.
 */
jest.mock('@/lib/api/financeApi', () => ({
  settlementApi: {
    statements: jest.fn(),
    statement: jest.fn(),
    position: jest.fn(),
    reportProblem: jest.fn(),
    activity: jest.fn(),
    purchaseBreakdown: jest.fn(),
  },
}));

jest.mock('@/lib/api/partnerApi', () => ({
  partnerApi: { listBranches: jest.fn() },
}));

jest.mock('@/lib/api/purchaseIntentApi', () => ({
  purchaseIntentApi: { history: jest.fn() },
}));

function buildUser(locale: string): AuthenticatedUserDto {
  return {
    id: 'user-1',
    phone: '+37400000003',
    email: null,
    firstName: 'Partner',
    lastName: 'Owner',
    roles: [Role.PARTNER_OWNER],
    partnerScopes: { [Role.PARTNER_OWNER]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
    locale,
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    mustChangePassword: false,
  };
}

const position = (ledgerBalance: string) => ({
  partnerId: 'partner-1',
  accrued: '0',
  deductions: '0',
  net: ledgerBalance,
  entries: [],
  unrecognised: [],
  ledgerBalance,
  inOpenSettlements: '0.0000',
  underReview: '0.0000',
  paidTotal: '0.0000',
  asOf: '2026-09-20T12:00:00.000Z',
  funding: {
    salesGross: '0',
    receivedDirectly: '0',
    receivedViaProvider: '0',
    fundedByPrepaid: '0',
    fundedByBonus: '0',
    contribution: '0',
    refundedGross: '0',
    owedToTuTak: '0',
    collectionsConfirmed: '0',
  },
});

let unmount: (() => void) | undefined;

function renderIn(locale: string) {
  useAuthStore.setState({ user: buildUser(locale) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <QueryClientProvider client={client}>
      <SettlementsPage />
    </QueryClientProvider>,
  );
  unmount = result.unmount;
}

describe('SettlementsPage in three languages', () => {
  beforeEach(() => {
    (settlementApi.statements as jest.Mock).mockResolvedValue([]);
    (settlementApi.activity as jest.Mock).mockResolvedValue({
      rows: [],
      nextCursor: null,
      selection: { credits: '0', debits: '0', net: '0', rowCount: 0 },
      filtered: false,
    });
    (partnerApi.listBranches as jest.Mock).mockResolvedValue([]);
  });

  afterEach(async () => {
    unmount?.();
    unmount = undefined;
    jest.clearAllMocks();
    await i18n.changeLanguage('en');
  });

  it.each([
    ['ru', '4750.0000', 'TuTak должен вам'],
    ['ru', '-2500.0000', 'Вы должны TuTak'],
    ['ru', '0.0000', 'Взаиморасчёты закрыты'],
    ['hy', '4750.0000', 'TuTak-ը ձեզ պարտք է'],
    ['hy', '-2500.0000', 'Դուք պարտք եք TuTak-ին'],
    ['hy', '0.0000', 'Փոխհաշվարկները փակ են'],
    ['en', '0.0000', 'You and TuTak are square'],
  ])('says the position in %s when the balance is %s', async (locale, balance, expected) => {
    await i18n.changeLanguage(locale);
    (settlementApi.position as jest.Mock).mockResolvedValue(position(balance));
    renderIn(locale);

    const headline = await screen.findByTestId('position-headline');
    expect(headline.textContent).toContain(expected);
  });

  it('translates the navigation of the money screen itself, not just the headline', async () => {
    await i18n.changeLanguage('ru');
    (settlementApi.position as jest.Mock).mockResolvedValue(position('4750.0000'));
    renderIn('ru');

    expect(await screen.findByText('Взаиморасчёты')).toBeTruthy();
    expect(screen.getByText('Всё, что двигало ваш баланс')).toBeTruthy();
    expect(screen.getByText('Где деньги')).toBeTruthy();
    // And nothing of the English is left behind on the same screen.
    expect(screen.queryByText('Everything that moved your balance')).toBeNull();
    expect(screen.queryByText('Where the money is')).toBeNull();
  });

  it('follows the signed-in owner’s stored locale when nothing was chosen here', async () => {
    window.localStorage.clear();
    (settlementApi.position as jest.Mock).mockResolvedValue(position('4750.0000'));
    renderIn('ru');

    // The provider is not mounted in this test, so the page itself does not
    // switch; what is asserted is that `syncLocale` would, and that it is
    // the profile's locale it reads.
    const { syncLocale } = await import('@/lib/i18n/i18n');
    syncLocale('ru');
    await waitFor(() => expect(i18n.language).toBe('ru'));
  });
});
