import * as React from 'react';
import {
  JAKO_VIEWBOX,
  jakoEye,
  jakoPaths,
  jakoSilhouette,
  type JakoColors,
} from '../../brand/jako-paths';
import { jakoDefaultColors } from '../../index';

/**
 * Jako for the web, rendering the same shared path data as the native app.
 * Appears on the sign-in screens, in the sidebar lockup, and in empty
 * states — nowhere else.
 */
export function Jako({
  size = 40,
  colors,
  className,
}: {
  size?: number;
  colors?: Partial<JakoColors>;
  className?: string;
}) {
  const c = { ...jakoDefaultColors, ...colors };
  const fillFor: Record<string, string> = {
    brand: c.brand,
    body: c.body,
    crown: c.crown,
    beak: c.beak,
    beakShadow: c.beakShadow,
    scallops: c.scallops,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={JAKO_VIEWBOX}
      fill="none"
      className={className}
      role="img"
      aria-label="TuTak"
    >
      {jakoPaths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          fill={fillFor[p.token]}
          opacity={'opacity' in p ? (p as { opacity: number }).opacity : 1}
        />
      ))}
      <ellipse
        cx={jakoEye.patch.cx}
        cy={jakoEye.patch.cy}
        rx={jakoEye.patch.rx}
        ry={jakoEye.patch.ry}
        fill={c.eyePatch}
      />
      <circle cx={jakoEye.pupil.cx} cy={jakoEye.pupil.cy} r={jakoEye.pupil.r} fill={c.pupil} />
      <circle
        cx={jakoEye.catchlight.cx}
        cy={jakoEye.catchlight.cy}
        r={jakoEye.catchlight.r}
        fill={c.catchlight}
      />
    </svg>
  );
}

/** Ghosted silhouette for card watermarks. Decorative — hidden from AT. */
export function JakoWatermark({
  size = 220,
  color = '#FFFFFF',
  opacity = 0.07,
  className,
}: {
  size?: number;
  color?: string;
  opacity?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={JAKO_VIEWBOX}
      fill="none"
      className={className}
      style={{ opacity }}
      aria-hidden="true"
    >
      <path d={jakoSilhouette} fill={color} />
    </svg>
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
