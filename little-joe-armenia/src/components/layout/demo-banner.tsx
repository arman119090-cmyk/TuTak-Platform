export function DemoBanner({ text }: { text: string }) {
  return (
    <div role="note" className="bg-ink px-4 py-2 text-center text-[0.78rem] font-medium leading-snug text-white" data-testid="demo-banner">
      {text}
    </div>
  );
}
