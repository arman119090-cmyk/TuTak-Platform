import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { artworkUrl } from '@/lib/media/artwork';
import { cn } from '@/lib/utils';

/** Wide editorial block used for kitchens, doors and the premium collection. */
export const PromoBlock = ({
  eyebrow,
  title,
  text,
  ctaLabel,
  href,
  secondary,
  artKey,
  tone,
  reverse,
  dark,
  bullets,
}: {
  eyebrow?: string;
  title: string;
  text: string;
  ctaLabel: string;
  href: string;
  secondary?: { label: string; href: string };
  artKey: string;
  tone: string;
  reverse?: boolean;
  dark?: boolean;
  bullets?: string[];
}) => (
  <section className="container-page py-10 md:py-14">
    <div
      className={cn(
        'grid overflow-hidden rounded-[var(--radius-lg)] md:grid-cols-2',
        dark ? 'bg-ink text-white' : 'bg-surface-2',
      )}
    >
      <div className={cn('flex flex-col justify-center p-7 md:p-12', reverse && 'md:order-2')}>
        {eyebrow ? (
          <p className={cn('eyebrow mb-3', dark && 'text-white/60')}>{eyebrow}</p>
        ) : null}
        <h2 className="text-[28px] leading-tight md:text-[40px]">{title}</h2>
        <p className={cn('mt-4 max-w-md text-sm md:text-[15px]', dark ? 'text-white/75' : 'text-ink-soft')}>
          {text}
        </p>
        {bullets?.length ? (
          <ul className={cn('mt-5 space-y-2 text-[13px]', dark ? 'text-white/75' : 'text-muted')}>
            {bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2.5">
                <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', dark ? 'bg-white/50' : 'bg-accent')} />
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href={href}
            className={cn(
              'inline-flex h-12 items-center gap-2 rounded-[var(--radius-sm)] px-6 text-sm font-medium',
              dark ? 'bg-white text-ink hover:bg-white/90' : 'bg-ink text-white hover:bg-ink-soft',
            )}
          >
            {ctaLabel} <ArrowRight width={16} height={16} />
          </Link>
          {secondary ? (
            <Link
              href={secondary.href}
              className={cn(
                'inline-flex h-12 items-center rounded-[var(--radius-sm)] border px-6 text-sm',
                dark ? 'border-white/30 hover:border-white' : 'border-line-strong bg-surface hover:border-ink',
              )}
            >
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
      <div className={cn('relative min-h-[240px]', reverse && 'md:order-1')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={artworkUrl(artKey, tone, 3, artKey.length + 7)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    </div>
  </section>
);
