import type { Metadata } from 'next';
import { themeInitScript, Providers } from '@tutak/design/web';
import './globals.css';

export const metadata: Metadata = {
  title: 'TuTak Admin',
  description: 'TuTak platform administration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `suppressHydrationWarning` because the inline script below sets
  // `data-theme` before React runs, so the server's markup and the client's
  // disagree by exactly that attribute — which is the intent.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking, in <head>, on purpose: React would set the theme after
            hydration and the user would see a white flash first. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
