import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ContributionRuleKind,
  PaymentRoute,
  PurchaseConfirmationSource,
  PurchaseIntentStatus,
  RefundRequestStatus,
  Role,
  UnitOfMeasure,
  type AuthenticatedUserDto,
  type PurchaseIntentDto,
  type PurchaseIntentRefundRequestDto,
} from '@tutak/shared-types';
import PurchaseIntentsPage from './purchase-intents/page';
import RefundsPage from './refunds/page';
import i18n from '@/lib/i18n/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import { purchaseIntentApi } from '@/lib/api/purchaseIntentApi';
import { refundRequestApi } from '@/lib/api/refundRequestApi';

/**
 * The two screens somebody actually stands at a till with, in the languages
 * they will be standing there in.
 *
 * The key-parity test proves the three bundles agree with each other; it
 * cannot tell whether a screen reads them. A page with one English sentence
 * left in the markup passes parity and still says "Confirm" to a cashier who
 * does not read English — and on these two screens the sentence in question
 * is the one that decides whether money is taken from a customer. So this
 * asserts the copy that carries the instruction, and that the English it
 * replaced is gone from the same render.
 */

jest.mock('@/lib/api/purchaseIntentApi', () => ({
  purchaseIntentApi: {
    list: jest.fn(),
    confirm: jest.fn(),
    approveForPayment: jest.fn(),
    reject: jest.fn(),
    pendingExternalRefunds: jest.fn(),
    confirmExternalRefund: jest.fn(),
  },
}));
jest.mock('@/lib/api/refundRequestApi', () => ({
  refundRequestApi: { list: jest.fn(), create: jest.fn(), approve: jest.fn(), reject: jest.fn() },
}));

function signIn(role: Role, locale: string) {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      phone: '+37400000004',
      email: null,
      firstName: 'Partner',
      lastName: 'Person',
      roles: [role],
      partnerScopes: { [role]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
      locale,
      isPhoneVerified: true,
      avatar: null,
      showAvatarInReferralList: false,
      personalizedRecommendationsEnabled: false,
      mustChangePassword: false,
    } as AuthenticatedUserDto,
    accessToken: 'token',
  });
}

function intent(overrides: Partial<PurchaseIntentDto> = {}): PurchaseIntentDto {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444455556666',
    customerId: 'customer-1',
    partnerId: 'partner-1',
    partnerBranchId: null,
    status: PurchaseIntentStatus.AWAITING_CONFIRMATION,
    confirmationCode: '0042',
    grossAmount: '15000',
    bonusAmountRequested: '1000',
    ordinaryPaymentRemainder: '14000',
    prepaidAmountApplied: '0',
    refundedAmount: '0',
    paymentRoute: PaymentRoute.DIRECT_PARTNER,
    quantity: null,
    quantityUnit: null,
    unitPrice: null,
    contributionRuleKind: null,
    contributionRuleVersion: null,
    merchantApprovedAt: null,
    merchantApprovedByUserId: null,
    negotiatedRateBps: 500,
    maxBonusPaymentPercent: 100,
    partnerBrand: { partnerId: 'partner-1', displayName: 'HAZE', logo: null },
    confirmedByUserId: null,
    confirmation: null,
    rejectedByUserId: null,
    rejectionReason: null,
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 170_000).toISOString(),
    confirmedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function confirmedPurchase(): PurchaseIntentDto {
  return intent({
    id: 'ffffffff-1111-2222-3333-444455556666',
    status: PurchaseIntentStatus.CONFIRMED,
    merchantApprovedAt: new Date('2026-09-12T09:01:00Z').toISOString(),
    merchantApprovedByUserId: 'owner-1',
    confirmedByUserId: 'owner-1',
    confirmation: {
      source: PurchaseConfirmationSource.STAFF,
      employeeCode: 'EMP-001',
      assignmentId: null,
      role: null,
    },
    confirmedAt: new Date('2026-09-12T09:01:00Z').toISOString(),
  });
}

function refundRequest(): PurchaseIntentRefundRequestDto {
  return {
    id: 'request-1',
    purchaseIntentId: 'cccccccc-1111-2222-3333-444455556666',
    partnerId: 'partner-1',
    partnerBranchId: null,
    amount: '1500.0000',
    reason: 'Wrong size',
    status: RefundRequestStatus.PENDING,
    requestedByUserId: 'cashier-1',
    requestedAt: new Date('2026-09-12T10:00:00Z').toISOString(),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    refundId: null,
  };
}

let unmount: (() => void) | undefined;

function renderPage(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  unmount = () => {
    view.unmount();
    client.clear();
  };
  return view;
}

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('the cashier queue in three languages', () => {
  it.each([
    ['ru', 'Подтвердить', 'Взять с клиента'],
    ['hy', 'Հաստատել', 'Վերցնել հաճախորդից'],
  ])('says what to do in %s', async (locale, action, collect) => {
    signIn(Role.PARTNER_STAFF, locale);
    (purchaseIntentApi.list as jest.Mock).mockResolvedValue([intent()]);
    await i18n.changeLanguage(locale);
    renderPage(<PurchaseIntentsPage />);

    expect(await screen.findByRole('button', { name: action })).toBeTruthy();
    expect(screen.getByText(collect)).toBeTruthy();
    // The English it replaced is gone from the same screen — a half-
    // translated till is worse than an English one, because it reads as
    // though the untranslated line is a different kind of instruction.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByText('To collect')).toBeNull();
  });

  it('translates the unit a per-unit business is paid by', async () => {
    signIn(Role.PARTNER_STAFF, 'ru');
    (purchaseIntentApi.list as jest.Mock).mockResolvedValue([
      intent({
        quantity: '50',
        quantityUnit: UnitOfMeasure.LITER,
        unitPrice: '300',
        contributionRuleKind: ContributionRuleKind.FIXED_PER_UNIT,
        contributionRuleVersion: 1,
      }),
    ]);
    await i18n.changeLanguage('ru');
    renderPage(<PurchaseIntentsPage />);

    // "за каждый л" — the unit label comes from the shared financial enum
    // bundle, so it follows the panel's language rather than being English
    // beside Russian.
    expect(await screen.findByText(/за каждый л\./)).toBeTruthy();
    expect(screen.queryByText(/paid per/i)).toBeNull();
  });

  it('warns in Armenian that a TuTak-paid purchase takes no cash', async () => {
    signIn(Role.PARTNER_STAFF, 'hy');
    (purchaseIntentApi.list as jest.Mock).mockResolvedValue([
      intent({
        paymentRoute: PaymentRoute.TUTAK_PSP,
        merchantApprovedAt: new Date().toISOString(),
      }),
    ]);
    await i18n.changeLanguage('hy');
    renderPage(<PurchaseIntentsPage />);

    expect(await screen.findByText(/կանխիկ մի վերցրեք/)).toBeTruthy();
    expect(screen.queryByText(/do not take cash for it/i)).toBeNull();
  });
});

describe('the returns screen in three languages', () => {
  beforeEach(() => {
    (refundRequestApi.list as jest.Mock).mockResolvedValue([refundRequest()]);
    (purchaseIntentApi.list as jest.Mock).mockResolvedValue([confirmedPurchase()]);
    (purchaseIntentApi.pendingExternalRefunds as jest.Mock).mockResolvedValue([]);
  });

  it.each([
    ['ru', 'Возвраты', 'Согласовать', 'Отказать'],
    ['hy', 'Վերադարձներ', 'Հաստատել', 'Մերժել'],
  ])('offers an owner the decision in %s', async (locale, title, approve, refuse) => {
    signIn(Role.PARTNER_OWNER, locale);
    await i18n.changeLanguage(locale);
    renderPage(<RefundsPage />);

    expect(await screen.findByText(title)).toBeTruthy();
    // Awaited, not read straight away: the heading is static, so it resolves
    // before the request list has arrived.
    expect(await screen.findByRole('button', { name: approve })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: refuse }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuse' })).toBeNull();
  });

  it('tells a Russian-speaking cashier the decision is not theirs', async () => {
    signIn(Role.PARTNER_STAFF, 'ru');
    await i18n.changeLanguage('ru');
    renderPage(<RefundsPage />);

    expect(await screen.findByText('Ждёт владельца или управляющего')).toBeTruthy();
    expect(screen.queryByText('Waiting for an owner or manager')).toBeNull();
    expect(screen.getByRole('button', { name: 'Запросить возврат' })).toBeTruthy();
  });
});
