import type { Metadata } from 'next';
import { themeToCssBlock } from '@cashout/design-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cash Out — operations',
  description: 'Operations console for Cash Out driver payouts',
  robots: { index: false, follow: false },
};

/**
 * The design tokens are emitted as CSS custom properties here, from the same
 * package the mobile app imports. The panel therefore cannot drift from the
 * app's palette, spacing or type scale — there is one source, rendered twice.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeToCssBlock('light') }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
