import type { Metadata } from 'next';
import { themeInitScript, Providers } from '@tutak/design/web';
import './globals.css';

export const metadata: Metadata = {
  title: 'TuTak Checkout',
  description: 'Confirm your order with your TuTak account',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const runtimeConfig = JSON.stringify({ apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '' }).replace(/</g, '\\u003c');
  return (
    <html lang="hy" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: `window.__TUTAK_RUNTIME_CONFIG__=${runtimeConfig};` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
