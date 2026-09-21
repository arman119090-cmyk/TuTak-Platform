'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Portal } from './portal';

/**
 * Dialog used by quick view, the request forms and the filter drawer.
 * Full-screen sheet on phones, centred card on desktop; Escape and the
 * backdrop both close it, and body scroll is locked while it is open.
 */
export const Modal = ({
  title,
  subtitle,
  onClose,
  children,
  size = 'md',
  footer,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const sizes = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-3xl',
    xl: 'sm:max-w-5xl',
  } as const;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={onClose} />
        <div
          className={cn(
            'fade-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] bg-surface shadow-[var(--shadow-pop)] sm:rounded-[var(--radius-lg)]',
            sizes[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              {title ? <h2 className="text-xl">{title}</h2> : null}
              {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-2"
            >
              <X width={20} height={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-4">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
};
