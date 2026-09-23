export function DemoBanner({ text }: { text: string }) {
  return (
    <div role="note" className="border-b border-brand/10 bg-brand-50 px-4 py-1.5 text-center text-[0.72rem] font-medium tracking-[0.01em] text-brand-600" data-testid="demo-banner">
      {text}
    </div>
  );
}
