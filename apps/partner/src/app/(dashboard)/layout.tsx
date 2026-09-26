import { AuthGate } from '@/components/AuthGate';
import { Sidebar } from '@/components/Sidebar';
import { ShiftBar } from '@/components/ShiftBar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Sidebar>
        <ShiftBar />
        {children}
      </Sidebar>
    </AuthGate>
  );
}
