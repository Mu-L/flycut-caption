import { useId } from 'react';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  label?: string;
  showWordmark?: boolean;
}

export function BrandLogo({
  className,
  label = 'FlyCut Caption',
  showWordmark = true,
}: BrandLogoProps) {
  const id = useId().replace(/:/g, '');
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const coralId = `${id}-coral`;
  const glowId = `${id}-glow`;
  const cutIndex = label.indexOf('Cut');

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        className="h-7 w-10 shrink-0"
        viewBox="0 0 96 64"
        fill="none"
        role={showWordmark ? undefined : 'img'}
        aria-hidden={showWordmark ? true : undefined}
        aria-labelledby={showWordmark ? undefined : `${titleId} ${descId}`}
      >
        {!showWordmark && (
          <>
            <title id={titleId}>{label}</title>
            <desc id={descId}>Caption tracks cut by a coral timeline blade.</desc>
          </>
        )}
        <defs>
          <linearGradient id={coralId} x1="54" y1="2" x2="42" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--aimu-accent-coral)" />
            <stop offset=".56" stopColor="#ff8078" />
            <stop offset="1" stopColor="#d94a4d" />
          </linearGradient>
          <filter id={glowId} x="20" y="-6" width="56" height="76" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
            <feFlood floodColor="var(--aimu-accent-coral)" floodOpacity=".35" />
            <feComposite in2="SourceAlpha" operator="in" />
            <feGaussianBlur stdDeviation="3.5" />
            <feBlend in="SourceGraphic" mode="screen" />
          </filter>
        </defs>
        <path fill="var(--aimu-text-primary)" d="M14 13h31c3.314 0 6 2.686 6 6v7H20a6 6 0 0 1-6-6v-7Z" />
        <path fill="var(--aimu-text-primary)" d="M54 13h28v7a6 6 0 0 1-6 6H54V13Z" />
        <path fill="var(--aimu-text-muted)" fillOpacity=".72" d="M14 38h34v13H20a6 6 0 0 1-6-6v-7Z" />
        <path fill="var(--aimu-text-muted)" fillOpacity=".72" d="M52 38h30v7a6 6 0 0 1-6 6H52V38Z" />
        <path stroke="var(--aimu-bg-page)" strokeLinecap="round" strokeWidth="7" d="M60 6 36 58" />
        <path filter={`url(#${glowId})`} fill={`url(#${coralId})`} d="M57.986 3.5h4.812L38.014 60.5h-4.812L57.986 3.5Z" />
        <path stroke="#fff" strokeLinecap="round" strokeOpacity=".55" strokeWidth="1.1" d="M58.5 8.5 35.5 55.5" />
      </svg>
      {showWordmark && (
        <span className="text-lg font-bold leading-none tracking-tight text-aimu-text-primary">
          {cutIndex >= 0 ? (
            <>
              {label.slice(0, cutIndex)}
              <span className="text-aimu-coral">Cut</span>
              {label.slice(cutIndex + 3)}
            </>
          ) : label}
        </span>
      )}
    </span>
  );
}
