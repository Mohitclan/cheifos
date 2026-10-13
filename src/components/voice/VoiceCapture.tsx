'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';
import { toast } from 'sonner';
import { buttonClass } from '@/components/ui';

/**
 * Optional voice capture via the Web Speech API.
 *
 * It is optional in the strict sense: typing always works, the sample
 * transcript buttons sit beside it, and where the API is missing this renders
 * a disabled control that says so rather than a button that fails when
 * pressed. The API is Chrome-only and routes audio to a remote service, which
 * is stated in the tooltip - nobody should discover that mid-demo.
 *
 * Fully local transcription needs a model on disk and is a v1.3 item.
 */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Nothing to subscribe to - API availability does not change at runtime. */
const noSubscribe = () => () => {};

export function VoiceCapture({
  onTranscript,
  idleLabel = 'Dictate',
  onListeningChange,
}: {
  onTranscript: (text: string) => void;
  idleLabel?: string;
  /** Lets a parent mirror the open microphone, e.g. in the avatar. */
  onListeningChange?: (listening: boolean) => void;
}) {
  // useSyncExternalStore rather than an effect: the server snapshot is "not
  // supported", the client snapshot is the real answer, and hydration swaps
  // them without a mismatch or a cascading render.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => getRecognitionCtor() !== null,
    () => false,
  );
  const [listening, setListeningState] = useState(false);
  const setListening = useCallback(
    (value: boolean) => {
      setListeningState(value);
      onListeningChange?.(value);
    },
    [onListeningChange],
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  if (!supported) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold text-ink-400"
        title="This browser has no Web Speech API. Type the update or load a sample transcript."
      >
        <MicOff size={14} aria-hidden /> Voice not available here
      </span>
    );
  }

  function start(): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const alternative = event.results[i]?.[0];
        if (alternative?.transcript) parts.push(alternative.transcript);
      }
      const transcript = parts.join(' ').trim();
      if (transcript) {
        onTranscript(transcript);
        toast.success('Transcript captured. Check it before submitting.');
      }
    };

    recognition.onerror = (event) => {
      setListening(false);
      toast.error(
        event.error === 'not-allowed'
          ? 'Microphone permission was declined. Type the update instead.'
          : 'Voice capture failed. Type the update or load a sample transcript.',
      );
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stop(): void {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      className={buttonClass(listening ? 'danger' : 'secondary', 'text-xs')}
      title="Chrome only. Audio is processed by the browser's speech service, not locally."
    >
      {listening ? <Square size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
      {listening ? 'Stop and use transcript' : idleLabel}
    </button>
  );
}
