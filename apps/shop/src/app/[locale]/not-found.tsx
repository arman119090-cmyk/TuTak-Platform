import Link from 'next/link';
import { PackageSearch } from 'lucide-react';

/** 404 inside the storefront shell (header/footer stay in place). */
const NotFound = () => (
  <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-20 text-center">
    <PackageSearch width={48} height={48} strokeWidth={1.3} className="text-muted" />
    <h1 className="mt-5 text-[30px]">Страница не найдена</h1>
    <p className="mt-2 max-w-md text-sm text-muted">
      Возможно, товар снят с производства или ссылка устарела.
    </p>
    <Link
      href="/ru"
      className="mt-7 inline-flex h-12 items-center rounded-[var(--radius-sm)] bg-ink px-6 text-sm font-medium text-white"
    >
      На главную
    </Link>
  </div>
);

export default NotFound;
