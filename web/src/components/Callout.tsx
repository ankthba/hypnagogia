import type { ReactNode } from 'react';

type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'info';

const TONES: Record<Tone, string> = {
  positive: 'border-emerald-500/60 bg-emerald-500/10',
  negative: 'border-red-500/70 bg-red-500/10',
  warning: 'border-orange-500/70 bg-orange-500/10',
  neutral: 'border-slate-600 bg-slate-800/60',
  info: 'border-sky-500/50 bg-sky-500/10',
};

export default function Callout({ tone, title, children }: { tone: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${TONES[tone]}`}>
      <div className="text-base font-semibold text-slate-100">{title}</div>
      {children && <div className="mt-1.5 text-sm text-slate-200">{children}</div>}
    </div>
  );
}
