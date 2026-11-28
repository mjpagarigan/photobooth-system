import type { ReactElement } from 'react';

import type { SessionPrintStatus as SessionPrintStatusData } from '@grace-booth/shared';
import { CheckCircle, Printer, SpinnerGap, Warning, WarningCircle } from '@grace-booth/ui';

import {
  describeSessionPrintStatus,
  type SessionPrintIconKind,
  type SessionPrintTone,
} from './session-print-presentation';

export type SessionPrintStatusProps = {
  status: SessionPrintStatusData | null | undefined;
  tone?: SessionPrintTone;
  announce?: boolean;
  className?: string;
  contextLabel?: string;
};

function renderIcon(kind: SessionPrintIconKind): ReactElement {
  switch (kind) {
    case 'spinner':
      return <SpinnerGap aria-hidden="true" className="spin" size={18} />;
    case 'check':
      return <CheckCircle aria-hidden="true" size={18} />;
    case 'warning':
      return <Warning aria-hidden="true" size={18} />;
    case 'warning-circle':
      return <WarningCircle aria-hidden="true" size={18} />;
    case 'printer':
      return <Printer aria-hidden="true" size={18} />;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function SessionPrintStatus({
  status,
  tone = 'light',
  announce = true,
  className,
  contextLabel,
}: SessionPrintStatusProps): ReactElement | null {
  if (!status) return null;
  const presentation = describeSessionPrintStatus(status);
  const classes = [
    'session-print-status',
    `session-print-status--${presentation.visualState}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-testid="session-print-status"
      data-print-phase={status.phase}
      data-print-origin={status.origin}
      data-tone={tone}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? 'true' : undefined}
    >
      <span className="session-print-status__icon" aria-hidden="true">
        {renderIcon(presentation.icon)}
      </span>
      <span className="session-print-status__copy">
        {contextLabel ? (
          <span className="session-print-status__context">{contextLabel}</span>
        ) : null}
        <span className="session-print-status__label">{presentation.label}</span>
        {presentation.detail ? (
          <span className="session-print-status__detail">{presentation.detail}</span>
        ) : null}
      </span>
    </div>
  );
}
