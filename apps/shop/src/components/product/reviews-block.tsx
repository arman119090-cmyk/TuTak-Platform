'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import type { Dictionary, Locale } from '@/lib/i18n';
import { formatDate, cn } from '@/lib/utils';
import { Button, Field, Rating, Textarea, Input, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { useStore } from '@/components/providers/store-provider';

export type ReviewView = {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
};

export const ReviewsBlock = ({
  productId,
  reviews,
  ratingAvg,
  locale,
  dict,
  isAuthenticated,
}: {
  productId: string;
  reviews: ReviewView[];
  ratingAvg: number;
  locale: Locale;
  dict: Dictionary;
  isAuthenticated: boolean;
}) => {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const distribution = [5, 4, 3, 2, 1].map((value) => ({
    value,
    count: reviews.filter((review) => review.rating === value).length,
  }));
  const max = Math.max(1, ...distribution.map((item) => item.count));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    const response = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, rating, title, body, locale }),
    });
    setSending(false);
    if (response.ok) {
      setOpen(false);
      setBody('');
      setTitle('');
      toast(dict.forms.successText);
    } else {
      toast(dict.forms.errorText, 'error');
    }
  };

  return (
    <div>
      <div className="mb-6 grid gap-6 rounded-[var(--radius-md)] border border-line bg-surface p-5 sm:grid-cols-[200px_1fr] sm:items-center">
        <div className="text-center sm:text-left">
          <p className="font-display text-[44px] leading-none">{ratingAvg.toFixed(1)}</p>
          <Rating value={ratingAvg} showValue={false} className="mt-2 justify-center sm:justify-start" />
          <p className="mt-1 text-[13px] text-muted">
            {reviews.length} {dict.product.reviewsCount}
          </p>
        </div>
        <div className="space-y-1.5">
          {distribution.map((item) => (
            <div key={item.value} className="flex items-center gap-3 text-[12px]">
              <span className="w-3 tabular-nums text-muted">{item.value}</span>
              <Star width={12} height={12} className="fill-accent text-accent" />
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(item.count / max) * 100}%` }}
                />
              </span>
              <span className="w-6 text-right tabular-nums text-muted">{item.count}</span>
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
            {dict.product.writeReview}
          </Button>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-muted">{dict.product.noReviews}</p>
      ) : (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-[var(--radius-md)] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium">{review.authorName}</span>
                <span className="text-[12px] text-muted">{formatDate(review.createdAt, locale)}</span>
              </div>
              <Rating value={review.rating} showValue={false} size={13} className="mt-1.5" />
              {review.title ? <p className="mt-2 text-[14px] font-medium">{review.title}</p> : null}
              <p className={cn('mt-1 text-[14px] leading-relaxed text-ink-soft')}>{review.body}</p>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <Modal title={dict.product.writeReview} onClose={() => setOpen(false)}>
          {!isAuthenticated ? (
            <Alert tone="info">{dict.auth.loginTitle} — {dict.account.title}</Alert>
          ) : null}
          <form onSubmit={submit} className="mt-4 space-y-4">
            <Field label={dict.catalog.rating} required>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value}`}>
                    <Star
                      width={28}
                      height={28}
                      className={value <= rating ? 'fill-accent text-accent' : 'text-line-strong'}
                    />
                  </button>
                ))}
              </div>
            </Field>
            <Field label={dict.forms.name}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
            </Field>
            <Field label={dict.forms.comment} required>
              <Textarea
                required
                minLength={10}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={sending || !isAuthenticated}>
              {dict.forms.submit}
            </Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
};
