import * as React from 'react';

/**
 * The glossy Jako lockup, rendered from the actual logo photo
 * (`/logo-mark.png`, copied into each Next.js app's `public/` — the same
 * source the mobile app bundles as `assets/logo-mark.png`) rather than a
 * hand-drawn vector approximation of it. Appears on the sign-in screens, in
 * the sidebar lockup, and in empty states — nowhere else. Per Arman's
 * request, 2026-08-23: the actual logo image everywhere a bird appears, not
 * a separately-illustrated stand-in for it — the same correction already
 * applied to the mobile app's `UserAvatar`/`PartnerMark`/`EmptyState`.
 */
export function Jako({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo-mark.png"
      width={size}
      height={size}
      alt="TuTak"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

/** Ghosted watermark for card backgrounds. Decorative — hidden from AT. */
export function JakoWatermark({
  size = 220,
  opacity = 0.07,
  className,
}: {
  size?: number;
  opacity?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, opacity, objectFit: 'contain' }}
    />
  );
}

/** Mark + wordmark, used in the dashboard sidebars. */
export function JakoLockup({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Jako size={32} />
      <div className="leading-tight">
        <div className="text-[17px] font-semibold tracking-[-0.02em] text-ink">TuTak</div>
        {subtitle ? <div className="text-[11px] text-faint">{subtitle}</div> : null}
      </div>
    </div>
  );
}
