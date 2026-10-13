'use client';

import { useState, useTransition } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { addBlockerComment } from '@/lib/actions';
import type { CommentRow } from '@/lib/db/queries';
import { ago } from '@/lib/format';

/**
 * Discussion on one blocker.
 *
 * This is talk, not instruction. Posting here does not send anything to the
 * employee's inbox and does not change the blocker's status - the panel says
 * so, because the whole product rests on that line being visible.
 */
export function BlockerComments({
  blockerId,
  authorId,
  comments,
}: {
  blockerId: number;
  authorId: number | null;
  comments: CommentRow[];
}) {
  const [open, setOpen] = useState(comments.length > 0);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function post() {
    if (authorId === null || body.trim().length === 0) return;
    const form = new FormData();
    form.set('blockerId', String(blockerId));
    form.set('authorId', String(authorId));
    form.set('body', body);

    startTransition(async () => {
      const result = await addBlockerComment(form);
      if (result.ok) {
        setBody('');
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-700 hover:underline"
      >
        <MessageSquare size={13} aria-hidden />
        Discuss this blocker
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-ink-400">
        <MessageSquare size={13} aria-hidden />
        Discussion
        <span className="font-normal text-ink-400">
          - comments stay here. They are not sent and do not change the status.
        </span>
      </p>

      {comments.length > 0 && (
        <ul className="mb-3 space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md bg-panel px-3 py-2">
              <p className="text-[11px] text-ink-400">
                <span className="font-semibold text-ink-700">{comment.author_name}</span>
                {comment.author_role === 'ceo' ? ' (CEO)' : ''} · {ago(comment.created_at)}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-700">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        placeholder="Add a note on this blocker, e.g. who you spoke to or what you want checked first"
        className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
      />

      {error && <p className="mt-1 text-[11px] text-blocked-700">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={post}
          disabled={pending || body.trim().length === 0 || authorId === null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          <Send size={13} aria-hidden />
          {pending ? 'Posting...' : 'Post comment'}
        </button>
        {comments.length === 0 && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-ink-400 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
