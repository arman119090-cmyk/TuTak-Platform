'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { artworkUrl } from '@/lib/media/artwork';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n';

type Slide = {
  key: string;
  href: string;
  artKey: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
};

const TONES = ['emerald', 'sand', 'graphite'];

/**
 * Hero slider. Auto-advances, pauses on hover/focus, and every slide is a real
 * link — a carousel that hides its content from keyboards is worse than none.
 */
export const Hero = ({ slides, locale }: { slides: Slide[]; locale: Locale }) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[index]!;
  const tone = TONES[index % TONES.length]!;

  return (
    <section
      className="relative overflow-hidden bg-surface-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      <div className="container-page grid items-center gap-6 py-10 md:grid-cols-2 md:gap-10 md:py-16">
        <div key={slide.key} className="fade-in order-2 md:order-1">
          {slide.eyebrow ? <p className="eyebrow mb-3">{slide.eyebrow}</p> : null}
          <h1 className="text-[34px] leading-[1.1] md:text-[52px]">{slide.title}</h1>
          <p className="mt-4 max-w-lg text-[15px] text-ink-soft md:text-base">{slide.subtitle}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={slide.href.startsWith('/') ? `/${locale}${slide.href}` : slide.href}
              className="inline-flex h-13 min-h-[52px] items-center gap-2 rounded-[var(--radius-sm)] bg-ink px-7 text-[15px] font-medium text-white hover:bg-ink-soft"
            >
              {slide.ctaLabel} <ArrowRight width={17} height={17} />
            </Link>
            <Link
              href={`/${locale}/catalog`}
              className="inline-flex h-13 min-h-[52px] items-center rounded-[var(--radius-sm)] border border-line-strong bg-surface px-7 text-[15px] hover:border-ink"
            >
              {locale === 'hy' ? 'Ամբողջ կատալոգը' : locale === 'en' ? 'Full catalogue' : 'Весь каталог'}
            </Link>
          </div>

          {slides.length > 1 ? (
            <div className="mt-8 flex gap-2" role="tablist">
              {slides.map((item, itemIndex) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={itemIndex === index}
                  aria-label={item.title}
                  onClick={() => setIndex(itemIndex)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    itemIndex === index ? 'w-10 bg-ink' : 'w-5 bg-line-strong hover:bg-muted',
                  )}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="order-1 md:order-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${slide.key}-art`}
            src={artworkUrl(slide.artKey, tone, 3, index + 1)}
            alt=""
            className="fade-in aspect-[4/3] w-full rounded-[var(--radius-lg)] object-cover shadow-[var(--shadow-card)]"
            fetchPriority="high"
          />
        </div>
      </div>
    </section>
  );
};
