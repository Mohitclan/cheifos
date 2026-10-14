'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { getComplianceCsv } from '@/lib/actions';

/** Hands the CEO a file they can forward, which is what "send me the report" means. */
export function DownloadCsv({ windowDays }: { windowDays: number }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const { filename, csv } = await getComplianceCsv(windowDays);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-ink-300 disabled:opacity-50"
    >
      <Download size={13} aria-hidden />
      {pending ? 'Preparing...' : 'Download CSV'}
    </button>
  );
}
