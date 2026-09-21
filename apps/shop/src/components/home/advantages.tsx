import { Truck, Wrench, ShieldCheck, Ruler } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';

export const Advantages = ({ dict }: { dict: Dictionary }) => {
  const items = [
    { icon: Truck, title: dict.advantages.deliveryTitle, text: dict.advantages.deliveryText },
    { icon: Wrench, title: dict.advantages.assemblyTitle, text: dict.advantages.assemblyText },
    { icon: ShieldCheck, title: dict.advantages.warrantyTitle, text: dict.advantages.warrantyText },
    { icon: Ruler, title: dict.advantages.measureTitle, text: dict.advantages.measureText },
  ];
  return (
    <section className="border-y border-line bg-surface">
      <div className="container-page grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {items.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent">
              <Icon width={20} height={20} strokeWidth={1.6} />
            </span>
            <div>
              <h3 className="text-[15px] font-sans font-semibold">{title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-muted">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
