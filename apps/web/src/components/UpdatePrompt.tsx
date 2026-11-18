import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Shows a prompt when a new version is deployed, instead of reloading under the user's feet. */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <div
      className="toasts"
      role="status"
      aria-live="polite"
      style={{ insetBlockEnd: 'calc(160px + env(safe-area-inset-bottom))' }}
    >
      <div className="toast">
        <span>{t('common.newVersion')}</span>
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          {t('common.reload')}
        </button>
      </div>
    </div>
  );
}
