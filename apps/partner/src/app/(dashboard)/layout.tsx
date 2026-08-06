import { AuthGate } from '@/components/AuthGate';
import { Sidebar } from '@/components/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Sidebar>{children}</Sidebar>
    </AuthGate>
  );
}
