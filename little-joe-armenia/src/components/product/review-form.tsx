"use client";

import { useActionState, useState } from "react";
import { submitReviewAction, type ReviewState } from "@/app/actions/reviews";
import { fmt, type Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { IconStar } from "@/components/ui/icons";

export function ReviewForm({ productId }: { productId: string }) {
  const { m, locale } = useI18n();
  const [state, action, pending] = useActionState<ReviewState, FormData>(submitReviewAction, { ok: false });
  const [rating, setRating] = useState(0);
  const err = (k: string) => {
    const code = state.errors?.[k];
    return code ? (m.validation[code as keyof Messages["validation"]] ?? m.validation.required) : null;
  };

  if (state.ok && state.message === "thanks") {
    return (
      <p role="status" className="rounded-2xl bg-ok/10 px-4 py-3 text-ok">
        {m.reviews.thanks}
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div aria-hidden="true" className="hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <fieldset>
        <legend className="label">{m.reviews.rating}</legend>
        <div className="flex gap-1" role="radiogroup" aria-label={m.reviews.rating}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={fmt(m.reviews.ratingStars, { n })}
              onClick={() => setRating(n)}
              className="tap inline-flex items-center justify-center rounded-full hover:bg-mist"
            >
              <IconStar filled={n <= rating} width={24} height={24} />
            </button>
          ))}
        </div>
        {err("rating") ? <p className="mt-1 text-sm text-bad">{err("rating")}</p> : null}
      </fieldset>
      <div>
        <label htmlFor="rv-name" className="label">
          {m.reviews.name}
        </label>
        <input id="rv-name" name="authorName" className="field" maxLength={60} autoComplete="given-name" aria-invalid={Boolean(err("authorName"))} />
        {err("authorName") ? <p className="mt-1 text-sm text-bad">{err("authorName")}</p> : null}
      </div>
      <div>
        <label htmlFor="rv-body" className="label">
          {m.reviews.body}
        </label>
        <textarea id="rv-body" name="body" rows={4} maxLength={2000} className="field" aria-invalid={Boolean(err("body"))} />
        {err("body") ? <p className="mt-1 text-sm text-bad">{err("body")}</p> : null}
      </div>
      {state.message === "rateLimited" ? <p className="text-sm text-bad">{m.common.rateLimited}</p> : null}
      {state.message === "error" ? <p className="text-sm text-bad">{m.common.genericError}</p> : null}
      <button type="submit" className="btn btn-primary justify-self-start" disabled={pending}>
        {m.reviews.submit}
      </button>
    </form>
  );
}
