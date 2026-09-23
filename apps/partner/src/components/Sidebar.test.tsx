import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Role, type AuthenticatedUserDto } from '@tutak/shared-types';
import { Sidebar } from './Sidebar';
import i18n from '@/lib/i18n/i18n';
import { useAuthStore } from '@/lib/stores/authStore';

/**
 * Navigation at phone width.
 *
 * Below the `lg` breakpoint the sidebar is `hidden`, and until 23.09.2026
 * nothing replaced it: on a phone the dashboard had no navigation at all and
 * every screen was reachable only by typing its address. What is pinned here
 * is that the menu exists, carries the same destinations, closes when one is
 * chosen, and can be operated without a mouse.
 *
 * jsdom has no layout, so `hidden lg:flex` does not actually hide anything
 * here — the assertions are about the drawer's behaviour and its accessible
 * names, and the widths themselves are measured in a real browser.
 */
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/api/authApi', () => ({
  authApi: { logout: jest.fn().mockResolvedValue(undefined) },
}));

let mockPathname = '/settlements';

function buildUser(roles: Role[] = [Role.PARTNER_OWNER]): AuthenticatedUserDto {
  return {
    id: 'user-1',
    phone: '+37400000003',
    email: null,
    firstName: 'Արման',
    lastName: 'Օհանեսյան',
    roles,
    partnerScopes: { [Role.PARTNER_OWNER]: ['partner-1'] } as AuthenticatedUserDto['partnerScopes'],
    locale: 'ru',
    isPhoneVerified: true,
    avatar: null,
    showAvatarInReferralList: false,
    personalizedRecommendationsEnabled: false,
    mustChangePassword: false,
  };
}

const drawer = () => screen.queryByRole('dialog');

describe('Sidebar at narrow width', () => {
  beforeEach(() => {
    mockPathname = '/settlements';
    useAuthStore.setState({ user: buildUser() });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('offers a menu button and keeps the drawer shut until it is pressed', () => {
    render(<Sidebar>page</Sidebar>);

    expect(drawer()).toBeNull();
    const button = screen.getByRole('button', { name: 'Open the menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('app-shell-drawer');
  });

  it('opens a labelled dialog carrying every destination the sidebar has', () => {
    render(<Sidebar>page</Sidebar>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));

    const panel = drawer()!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Main navigation');

    // The same thirteen destinations, not a reduced phone menu: somebody who
    // needs the employee list on a phone needs it as much as on a desktop.
    const inDrawer = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const href of [
      '/',
      '/transactions',
      '/qr',
      '/purchase-intents',
      '/refunds',
      '/earnings',
      '/settlements',
      '/ev-stations',
      '/branding',
      '/locations',
      '/employees',
      '/profile',
      '/integrations',
    ]) {
      expect(inDrawer).toContain(href);
    }
  });

  it('keeps sign-out and the language switch reachable from the drawer', () => {
    render(<Sidebar>page</Sidebar>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));

    const panel = drawer()!;
    expect(panel.textContent).toContain('Sign out');
    // The language list is the one control somebody opens the menu for when
    // the panel came up in a language they do not read.
    expect(panel.querySelector('select#panel-language')).not.toBeNull();
  });

  it('marks the current page in the drawer, not just in the sidebar', () => {
    render(<Sidebar>page</Sidebar>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));

    const current = Array.from(drawer()!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/settlements',
    )!;
    expect(current.className).toContain('text-brand');
  });

  it('closes when the page behind it changes', () => {
    const { rerender } = render(<Sidebar>page</Sidebar>);
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    expect(drawer()).not.toBeNull();

    // The app supplies its own router's Link, so the shell never sees the
    // click; the path changing is the only signal it gets that a
    // destination was chosen.
    mockPathname = '/employees';
    rerender(<Sidebar>page</Sidebar>);

    expect(drawer()).toBeNull();
  });

  it('closes on Escape and on the backdrop', () => {
    render(<Sidebar>page</Sidebar>);

    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(drawer()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close the menu' }));
    expect(drawer()).toBeNull();
  });

  it('returns focus to the button it came from', async () => {
    render(<Sidebar>page</Sidebar>);
    const button = screen.getByRole('button', { name: 'Open the menu' });

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });

    // Somebody navigating by keyboard must not be left on an element that
    // no longer exists.
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('names the menu in the language the panel is in', async () => {
    await i18n.changeLanguage('ru');
    render(<Sidebar>page</Sidebar>);

    expect(screen.getByRole('button', { name: 'Открыть меню' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
    expect(drawer()!.getAttribute('aria-label')).toBe('Основная навигация');
    expect(screen.getByRole('button', { name: 'Закрыть меню' })).toBeTruthy();
  });

  it('names the role in the panel’s language instead of an enum with the case knocked off', async () => {
    await i18n.changeLanguage('ru');
    const { container } = render(<Sidebar>page</Sidebar>);

    expect(container.textContent).toContain('Владелец');
    expect(container.textContent).not.toContain('partner owner');
    expect(container.textContent).not.toContain('PARTNER_OWNER');
  });
});
