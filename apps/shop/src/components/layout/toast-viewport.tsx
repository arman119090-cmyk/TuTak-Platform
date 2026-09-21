'use client';

import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useStore } from '@/components/providers/store-provider';

/** Bottom-right on desktop, bottom-centre on phones so it clears the thumb. */
export const ToastViewport = () => {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          className="fade-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-[var(--radius-sm)] bg-ink px-4 py-3 text-left text-[13px] text-white shadow-[var(--shadow-pop)]"
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 width={18} height={18} className="shrink-0 text-[#8FD3B6]" />
          ) : toast.kind === 'error' ? (
            <XCircle width={18} height={18} className="shrink-0 text-[#F0A79E]" />
          ) : (
            <Info width={18} height={18} className="shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
        </button>
      ))}
    </div>
  );
};
