import type { Metadata } from 'next';
import { themeInitScript, Providers } from '@tutak/design/web';
import './globals.css';

export const metadata: Metadata = {
  title: 'TuTak Partner',
  description: 'TuTak partner dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `suppressHydrationWarning` because the inline script below sets
  // `data-theme` before React runs, so the server's markup and the client's
  // disagree by exactly that attribute — which is the intent.
  const runtimeConfig = JSON.stringify({
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
  }).replace(/</g, '\\u003c');

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking, in <head>, on purpose: React would set the theme after
            hydration and the user would see a white flash first. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: `window.__TUTAK_RUNTIME_CONFIG__=${runtimeConfig};` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
