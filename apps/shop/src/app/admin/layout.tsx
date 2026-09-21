import type { Metadata } from 'next';
import '../globals.css';
import { requireAdmin } from '@/lib/auth/guards';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata: Metadata = {
  title: 'Админ-панель — ORNATA',
  robots: { index: false, follow: false },
};

/**
 * Admin shell.
 *
 * Its own root layout (the storefront has another), and every page under it is
 * behind `requireAdmin` — the guard runs here, so no admin page can forget it.
 * The panel is Russian-only by design: it is an internal operator tool.
 */
const AdminLayout = async ({ children }: { children: React.ReactNode }) => {
  const session = await requireAdmin('ru');

  return (
    <html lang="ru">
      <body>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <aside className="border-b border-line bg-surface lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:sticky lg:top-0">
            <AdminNav name={session.name} />
          </aside>
          <main className="min-w-0 flex-1 bg-bg p-4 md:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
};

export default AdminLayout;
