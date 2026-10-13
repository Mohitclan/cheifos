'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Pause, Play, RefreshCw, Send, Volume2, VolumeX } from 'lucide-react';
import { askChief, getBriefing } from '@/lib/actions';
import type { Briefing, BriefSegment } from '@/lib/chief/briefing';
import type { Answer } from '@/lib/chief/ask';
import { Panel, Pill, buttonClass, inputClass } from '@/components/ui';
import { Avatar, type AvatarState } from './Avatar';

/**
 * The chief-of-staff surface: an avatar that delivers the briefing aloud and
 * answers questions about what is in the records.
 *
 * Voice uses the browser's built-in speech synthesis - no account, no API key,
 * no audio leaves the machine. Where it is unavailable the panel still works
 * in full; the text is the product and the voice is the delivery.
 *
 * Nothing here can write. The panel calls two read-only server actions and
 * renders what comes back.
 */

interface Line {
  id: string;
  heading: string;
  text: string;
  detail?: string[];
  tone: BriefSegment['tone'];
  href?: string;
  /** Marks a question the assistant declined to answer rather than guess. */
  unanswered?: boolean;
  /** Who said it - the user's own questions are echoed into the transcript. */
  from: 'chief' | 'you';
}

const TONE_STYLES: Record<BriefSegment['tone'], string> = {
  neutral: 'border-line',
  accent: 'border-accent-500/50',
  ok: 'border-ok-500/50',
  risk: 'border-risk-500/50',
  blocked: 'border-blocked-500/50',
};

const noSubscribe = () => () => {};

function briefingToLines(briefing: Briefing): Line[] {
  return [
    { id: 'greeting', heading: 'Briefing', text: briefing.greeting, tone: 'accent', from: 'chief' },
    ...briefing.segments.map((segment) => ({
      id: segment.id,
      heading: segment.heading,
      text: segment.speech,
      detail: segment.detail,
      tone: segment.tone,
      href: segment.href,
      from: 'chief' as const,
    })),
  ];
}

export function ChiefPanel({ initialBriefing }: { initialBriefing: Briefing }) {
  const [lines, setLines] = useState<Line[]>(() => briefingToLines(initialBriefing));
  const [suggestions, setSuggestions] = useState<string[]>(initialBriefing.suggestions);
  const [question, setQuestion] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [state, setState] = useState<AvatarState>('idle');
  const [voiceOn, setVoiceOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Availability of speech synthesis, read without an effect so the server
  // render and the client render agree.
  const canSpeak = useSyncExternalStore(
    noSubscribe,
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    () => false,
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
    setState('idle');
  }, []);

  useEffect(() => stopSpeaking, [stopSpeaking]);

  /** Speaks a list of lines in order, highlighting each as it goes. */
  const speak = useCallback(
    (toSpeak: Line[]) => {
      if (!canSpeak || !voiceOn || toSpeak.length === 0) {
        // Still walk the transcript so the panel reads the same either way.
        setSpeakingId(toSpeak[toSpeak.length - 1]?.id ?? null);
        setState('idle');
        return;
      }

      window.speechSynthesis.cancel();
      setState('speaking');

      toSpeak.forEach((line, index) => {
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.rate = 1.02;
        utterance.pitch = 1;

        // Prefer an English voice if the platform offers one; otherwise take
        // the default rather than failing.
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((voice) => /en-(GB|IN)/i.test(voice.lang)) ??
          voices.find((voice) => /^en/i.test(voice.lang));
        if (preferred) utterance.voice = preferred;

        utterance.onstart = () => setSpeakingId(line.id);
        utterance.onend = () => {
          if (index === toSpeak.length - 1) {
            setSpeakingId(null);
            setState('idle');
          }
        };
        utterance.onerror = () => {
          setSpeakingId(null);
          setState('idle');
        };

        window.speechSynthesis.speak(utterance);
      });
    },
    [canSpeak, voiceOn],
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, speakingId]);

  async function refreshBriefing(): Promise<void> {
    stopSpeaking();
    setBusy(true);
    setState('thinking');
    const briefing = await getBriefing();
    const fresh = briefingToLines(briefing);
    setLines(fresh);
    setSuggestions(briefing.suggestions);
    setBusy(false);
    speak(fresh);
  }

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    stopSpeaking();
    setQuestion('');
    setBusy(true);
    setState('thinking');

    const asked: Line = {
      id: `you-${Date.now()}`,
      heading: 'You asked',
      text: trimmed,
      tone: 'neutral',
      from: 'you',
    };
    setLines((current) => [...current, asked]);

    const answer: Answer = await askChief(trimmed);
    const reply: Line = {
      id: `chief-${Date.now()}`,
      heading: answer.unanswered ? 'Outside what I can answer' : 'Answer',
      text: answer.speech,
      detail: answer.detail,
      tone: answer.tone,
      href: answer.href,
      unanswered: answer.unanswered,
      from: 'chief',
    };

    setLines((current) => [...current, reply]);
    setBusy(false);
    speak([reply]);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex flex-col items-center rounded-xl border border-line bg-navy-900 px-5 py-6">
          <Avatar state={state} size={150} />
          <p className="mt-4 text-sm font-semibold text-white">Chief of Staff</p>
          <p className="mt-0.5 text-center text-[11px] leading-relaxed text-navy-300">
            {state === 'speaking'
              ? 'Reading from the records'
              : state === 'thinking'
                ? 'Looking it up'
                : 'Ready when you are'}
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {speakingId ? (
              <button type="button" onClick={stopSpeaking} className={buttonClass('secondary', 'text-xs')}>
                <Pause size={14} aria-hidden /> Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => speak(lines.filter((line) => line.from === 'chief'))}
                className={buttonClass('primary', 'text-xs')}
              >
                <Play size={14} aria-hidden /> Brief me
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setVoiceOn((on) => !on);
              }}
              className={buttonClass('secondary', 'text-xs')}
              title={voiceOn ? 'Mute the voice; the transcript stays' : 'Turn the voice back on'}
            >
              {voiceOn ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
              {voiceOn ? 'Voice on' : 'Muted'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={refreshBriefing}
              className={buttonClass('quiet', 'text-xs text-navy-200 hover:bg-navy-800 hover:text-white')}
            >
              <RefreshCw size={14} aria-hidden /> Re-read
            </button>
          </div>

          {!canSpeak && (
            <p className="mt-3 text-center text-[11px] leading-relaxed text-risk-500">
              This browser has no speech synthesis, so the briefing is text only. Everything else works.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-panel px-4 py-3 text-[11px] leading-relaxed text-ink-500">
          <p className="font-semibold text-ink-700">What this is</p>
          <p className="mt-1">
            Every sentence is assembled from rows in the database. There is no model generating this, and the
            panel cannot approve, send or change anything.
          </p>
          <p className="mt-1.5">
            Voice is the browser&apos;s own speech synthesis. No audio leaves this machine.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <Panel
          title="Briefing and questions"
          subtitle="Ask in your own words. If it is not in the records, it says so instead of guessing."
          bodyClassName="px-0 py-0"
        >
          <div ref={transcriptRef} className="max-h-[32rem] space-y-3 overflow-y-auto px-5 py-4">
            {lines.map((line) =>
              line.from === 'you' ? (
                <div key={line.id} className="flex justify-end">
                  <p className="max-w-md rounded-lg rounded-br-sm bg-navy-900 px-3.5 py-2 text-sm text-white">
                    {line.text}
                  </p>
                </div>
              ) : (
                <article
                  key={line.id}
                  className={`rounded-lg border-l-4 bg-surface px-4 py-3 transition-colors ${TONE_STYLES[line.tone]} ${
                    speakingId === line.id ? 'ring-2 ring-accent-500/40' : ''
                  }`}
                >
                  <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                    {line.heading}
                    {line.unanswered && <Pill tone="risk">no answer invented</Pill>}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-900">{line.text}</p>

                  {line.detail && line.detail.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {line.detail.slice(0, 8).map((item, index) => (
                        <li key={`${line.id}-${index}`} className="text-xs text-ink-500">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}

                  {line.href && (
                    <Link href={line.href} className="mt-2 inline-block text-xs font-semibold text-accent-700 hover:underline">
                      Open the detail
                    </Link>
                  )}
                </article>
              ),
            )}
          </div>

          <div className="border-t border-line px-5 py-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask(question);
              }}
              className="flex gap-2"
            >
              <input
                className={inputClass}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask me anything about the work - what needs me, what is blocked, how a project is doing"
              />
              <button type="submit" disabled={busy} className={buttonClass('primary')}>
                <Send size={15} aria-hidden /> Ask
              </button>
            </form>

            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(suggestion)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-accent-600 hover:text-accent-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
