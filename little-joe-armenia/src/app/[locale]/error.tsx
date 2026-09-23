"use client";

import { useI18n } from "@/i18n/provider";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { m } = useI18n();
  return (
    <div className="container-lj flex min-h-[50vh] max-w-xl flex-col items-center justify-center py-20 text-center" role="alert">
      <h1 className="text-h2 font-extrabold">{m.errors.serverTitle}</h1>
      <p className="mt-3 text-ink-2">{m.errors.serverBody}</p>
      <button type="button" onClick={reset} className="btn btn-primary mt-8">
        {m.common.tryAgain}
      </button>
    </div>
  );
}
