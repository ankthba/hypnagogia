import type { ReactNode } from 'react';

type Tone = 'positive' | 'negative' | 'warning' | 'neutral' | 'info';

export default function Callout({ tone, title, children }: { tone: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`callout callout--${tone} measure`}>
      <div className="callout__title">{title}</div>
      {children && <div className="callout__body">{children}</div>}
    </div>
  );
}
