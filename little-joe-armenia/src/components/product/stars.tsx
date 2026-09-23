import { IconStar } from "@/components/ui/icons";

export function Stars({ value, label, size = 16 }: { value: number; label: string; size?: number }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5 text-ink" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <IconStar key={n} width={size} height={size} filled={n <= rounded} strokeWidth={1.5} />
      ))}
    </span>
  );
}
