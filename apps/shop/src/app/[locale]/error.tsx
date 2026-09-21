'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/** Storefront error boundary: a real recovery action, not a stack trace. */
const ErrorPage = ({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) => {
  useEffect(() => {
    // A real deployment forwards this to its error tracker.
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-20 text-center">
      <AlertTriangle width={44} height={44} strokeWidth={1.3} className="text-warning" />
      <h1 className="mt-5 text-[28px]">Ошибка на сервере</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        Мы уже чиним. Попробуйте обновить страницу через минуту.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-7 inline-flex h-12 items-center rounded-[var(--radius-sm)] bg-ink px-6 text-sm font-medium text-white"
      >
        Попробовать снова
      </button>
    </div>
  );
};

export default ErrorPage;
