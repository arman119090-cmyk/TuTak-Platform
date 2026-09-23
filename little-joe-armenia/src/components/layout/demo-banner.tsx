export function DemoBanner({ text }: { text: string }) {
  return (
    <div role="note" className="bg-ink px-4 py-1.5 text-center text-[0.68rem] font-medium tracking-[0.02em] text-[#fff8f1]/75" data-testid="demo-banner">
      {text}
    </div>
  );
}
