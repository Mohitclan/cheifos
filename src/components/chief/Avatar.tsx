'use client';

/**
 * The chief-of-staff figure.
 *
 * Drawn in SVG rather than rendered from a model or streamed from a service:
 * it costs nothing, works offline, and - the part that matters for this
 * product - it is unmistakably a representation rather than a person. A
 * photoreal face delivering machine-assembled sentences invites exactly the
 * trust this system is trying not to borrow.
 *
 * Every animation is CSS (see globals.css), driven by the state prop alone.
 * Nothing here re-renders while it speaks:
 *   idle      - slow breathing, periodic blink
 *   thinking  - a turning dashed ring
 *   speaking  - the mouth and the level bars move
 */

export type AvatarState = 'idle' | 'thinking' | 'speaking';

export function Avatar({ state, size = 160 }: { state: AvatarState; size?: number }) {
  const speaking = state === 'speaking';

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={
        speaking
          ? 'Chief of staff, speaking'
          : state === 'thinking'
            ? 'Chief of staff, looking it up'
            : 'Chief of staff'
      }
      className={state === 'idle' ? 'chief-breathe' : undefined}
    >
      <defs>
        <linearGradient id="chief-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2740" />
          <stop offset="100%" stopColor="#0b1220" />
        </linearGradient>
        <linearGradient id="chief-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#16a39a" />
          <stop offset="100%" stopColor="#0f6f6a" />
        </linearGradient>
      </defs>

      <circle cx="60" cy="60" r="58" fill="url(#chief-bg)" />

      {/* Activity ring: brighter while speaking, turning while thinking */}
      <circle
        cx="60"
        cy="60"
        r="54"
        fill="none"
        stroke="url(#chief-accent)"
        strokeWidth={state === 'idle' ? 1 : 2}
        strokeOpacity={state === 'idle' ? 0.35 : 0.9}
        strokeDasharray={state === 'thinking' ? '14 10' : undefined}
        className={state === 'thinking' ? 'chief-ring' : undefined}
      />

      {/* Shoulders and collar - what makes the silhouette read as a person at work */}
      <path d="M26 112c4-19 17-28 34-28s30 9 34 28" fill="#243352" />
      <path d="M50 86l10 12 10-12 6 4-16 18-16-18z" fill="#111b2e" />

      {/* Head */}
      <circle cx="60" cy="52" r="24" fill="#2c3d5e" />
      <path d="M36 46c2-14 11-20 24-20s22 6 24 20c-6-6-14-9-24-9s-18 3-24 9z" fill="#1a2740" />

      {/* Eyes. The blink is a scaleY on the group, so it needs no state. */}
      <g className="chief-blink" fill="#dce8f5">
        <circle cx="50.5" cy="51" r="3.1" />
        <circle cx="69.5" cy="51" r="3.1" />
      </g>

      {/* Mouth. Scaled vertically about its own centre while speaking. */}
      <g className={speaking ? 'chief-mouth' : undefined} style={{ transformOrigin: '60px 64px' }}>
        <rect x="54" y="62" width="12" height="4" rx="2" fill="#dce8f5" opacity="0.92" />
      </g>

      {/* Level meter: the visible sign that audio is actually playing */}
      <g transform="translate(44, 104)">
        {[0, 1, 2, 3, 4].map((index) => (
          <rect
            key={index}
            x={index * 7}
            y={-2}
            width="4"
            height="4"
            rx="2"
            fill="url(#chief-accent)"
            opacity={speaking ? 0.95 : 0.3}
            className={speaking ? 'chief-level' : undefined}
            style={speaking ? { animationDelay: `${index * 90}ms`, transformOrigin: 'center' } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
