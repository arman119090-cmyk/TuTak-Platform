import Link from 'next/link';
import './globals.css';

/**
 * Root 404. The app uses per-segment root layouts (storefront and admin each
 * own their <html>), so this page renders its own document.
 */
const RootNotFound = () => (
  <html lang="ru">
    <body>
      <main className="container-page flex min-h-screen flex-col items-center justify-center text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-4xl">Страница не найдена</h1>
        <p className="mt-3 text-sm text-muted">
          Возможно, ссылка устарела или товар снят с производства.
        </p>
        <Link
          href="/ru"
          className="mt-8 inline-flex h-12 items-center rounded-[var(--radius-sm)] bg-ink px-6 text-sm font-medium text-white"
        >
          На главную
        </Link>
      </main>
    </body>
  </html>
);

export default RootNotFound;
