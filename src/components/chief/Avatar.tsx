import Image from 'next/image';

/**
 * The chief of staff, as a portrait.
 *
 * A flat render cannot lip-sync, and faking a mouth on one looks worse than
 * not trying. So speech is carried by things that are honest about what they
 * are: a bob at speaking cadence, a live level meter, and a ring that reacts.
 * Listening radiates rings outward so it is obvious the microphone is open.
 *
 * Every looping animation is disabled under prefers-reduced-motion. The state
 * still changes - ring colour and the caption carry it - it just stops moving.
 */

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

const RING: Record<AvatarState, string> = {
  idle: 'ring-navy-700',
  listening: 'ring-risk-500',
  thinking: 'ring-navy-500',
  speaking: 'ring-accent-500',
};

const GLOW: Record<AvatarState, string> = {
  idle: 'opacity-0',
  listening: 'opacity-70 bg-risk-500/30',
  thinking: 'opacity-40 bg-navy-400/30',
  speaking: 'opacity-80 bg-accent-500/30',
};

/** Level-meter bars. Staggered so the row reads as speech, not a metronome. */
const BAR_DELAYS = ['0ms', '120ms', '60ms', '180ms', '30ms'];

export function Avatar({ state, size = 160 }: { state: AvatarState; size?: number }) {
  const speaking = state === 'speaking';
  const listening = state === 'listening';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Listening rings radiate outward: the microphone is open and the
            person on stage should not have to guess. */}
        {listening && (
          <>
            <span className="chief-pulse absolute inset-0 rounded-full border-2 border-risk-500/50" />
            <span
              className="chief-pulse absolute inset-0 rounded-full border-2 border-risk-500/35"
              style={{ animationDelay: '700ms' }}
            />
          </>
        )}

        <span
          className={`absolute -inset-2 rounded-full blur-xl transition-opacity duration-500 ${GLOW[state]}`}
          aria-hidden
        />

        <div
          className={`relative h-full w-full overflow-hidden rounded-full bg-white ring-2 transition-colors duration-300 ${RING[state]} ${
            state === 'idle' ? 'chief-breathe' : ''
          } ${speaking ? 'chief-bob' : ''}`}
        >
          <Image
            src="/chief-avatar.png"
            alt=""
            width={320}
            height={320}
            priority
            className="h-full w-full scale-105 object-cover object-top"
          />
        </div>

        {/* Thinking: a slow sweep around the portrait rather than a spinner
            inside it, so the figure stays readable while it works. */}
        {state === 'thinking' && (
          <span
            className="chief-ring absolute -inset-1 rounded-full border-2 border-dashed border-navy-400/60"
            aria-hidden
          />
        )}
      </div>

      {/* The level meter is the honest stand-in for a moving mouth. It only
          appears while speech is actually playing. */}
      <div className="flex h-5 items-end gap-1" aria-hidden>
        {BAR_DELAYS.map((delay, index) => (
          <span
            key={index}
            className={`w-1 rounded-full transition-all duration-300 ${
              speaking ? 'chief-level h-2 bg-accent-500' : 'h-1 bg-navy-700'
            }`}
            style={speaking ? { animationDelay: delay } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
