import { fireEvent, render, screen } from '@testing-library/react';
import { StorageNotice } from '@tutak/design/web';

/**
 * Lives in the admin app rather than beside the component: `@tutak/design`
 * has no jest runner (its only test is a `node --test` file on security
 * headers), and adding one there to test a single component would be more
 * machinery than the test is worth. It imports through the package entry
 * point, so it tests what consumers actually get.
 *
 * The notice is shown once and then remembered.
 *
 * Also asserted: that it is a *notice* and not a consent dialog. There is no
 * "reject" control, because there is nothing to reject — the two things
 * stored are strictly necessary. A dialog offering a choice that changes
 * nothing is worse than no dialog: it teaches people that dismissing these is
 * always safe, which is exactly the habit that makes a real analytics opt-in
 * useless later.
 */
describe('StorageNotice', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('tells somebody what is stored, on a first visit', () => {
    render(<StorageNotice />);
    expect(screen.getByText(/identifier for this device/i)).toBeTruthy();
  });

  it('stays dismissed once acknowledged', () => {
    const { unmount } = render(<StorageNotice />);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    unmount();

    render(<StorageNotice />);
    expect(screen.queryByText(/identifier for this device/i)).toBeNull();
  });

  it('offers no reject control, because nothing here is optional', () => {
    render(<StorageNotice />);
    expect(screen.queryByRole('button', { name: /reject|decline|only necessary/i })).toBeNull();
  });

  it('links the privacy policy when there is one to link', () => {
    render(<StorageNotice privacyUrl="https://tutak.am/privacy" />);
    expect(screen.getByRole('link', { name: /privacy policy/i }).getAttribute('href')).toBe(
      'https://tutak.am/privacy',
    );
  });

  /**
   * Private browsing throws on `localStorage`. A legal notice must not be
   * the thing that takes the dashboard down.
   */
  it('renders nothing rather than throwing when storage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => render(<StorageNotice />)).not.toThrow();
    getItem.mockRestore();
  });
});
