"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { paths } from "@/lib/paths";

export default function NotFound() {
  const { m, locale } = useI18n();
  return (
    <div className="container-lj flex min-h-[60vh] max-w-xl flex-col items-center justify-center py-20 text-center">
      <p className="text-7xl font-extrabold tracking-tight text-line-strong">404</p>
      <h1 className="mt-4 text-h2 font-extrabold" data-testid="not-found">
        {m.errors.notFoundTitle}
      </h1>
      <p className="mt-3 text-ink-2">{m.errors.notFoundBody}</p>
      <div className="mt-8 flex gap-3">
        <Link href={paths.home(locale)} className="btn btn-primary">
          {m.errors.goHome}
        </Link>
        <Link href={paths.shop(locale)} className="btn btn-ghost">
          {m.home.ctaShop}
        </Link>
      </div>
    </div>
  );
}
