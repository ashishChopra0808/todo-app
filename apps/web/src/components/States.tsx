import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

export function LoadingList({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="stack" role="status" aria-label={t('a11y.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = 'check',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </div>
      <p style={{ fontWeight: 600, fontSize: 17 }}>{title}</p>
      {body && <p className="muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="empty" role="alert">
      <div className="empty__icon" aria-hidden="true" style={{ color: 'var(--color-alert)' }}>
        <Icon name="alert" size={28} />
      </div>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn--secondary btn--small" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className="spinner"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
