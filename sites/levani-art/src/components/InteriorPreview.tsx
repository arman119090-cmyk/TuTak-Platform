'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons';

/**
 * "View in an Interior" — v1 entry point.
 *
 * No trustworthy interior composites exist yet, so the dialog shows the
 * unaltered photograph and says plainly that previews are in preparation.
 * When real composites exist, add them as `scenes` and render them here; the
 * artwork image itself is never edited.
 */
export function InteriorPreview({
  image,
  title,
  labels,
  enquireHref,
}: {
  image: { src: string; width: number; height: number; alt: string };
  title: string;
  labels: { open: string; title: string; placeholder: string; cta: string; close: string };
  enquireHref: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className="text-link interior-trigger" onClick={() => setOpen(true)}>
        <span className="interior-trigger__icon" aria-hidden="true" />
        {labels.open}
      </button>
      <dialog
        ref={ref}
        className="overlay interior"
        aria-labelledby="interior-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
      >
        <div className="interior__panel">
          <div className="interior__top">
            <div>
              <p className="eyebrow" id="interior-title">
                {labels.title}
              </p>
              <p className="interior__work">{title}</p>
            </div>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label={labels.close}>
              <CloseIcon size={22} />
            </button>
          </div>
          <div className="interior__stage">
            <Image src={image.src} width={image.width} height={image.height} alt={image.alt} sizes="(max-width: 720px) 80vw, 360px" />
          </div>
          <p className="interior__note">{labels.placeholder}</p>
          <Link href={enquireHref} className="button button--solid">
            {labels.cta}
          </Link>
        </div>
      </dialog>
    </>
  );
}
