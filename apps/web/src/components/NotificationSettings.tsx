import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@todo/shared';
import { useNotificationPrefs, useSetNotificationPref } from '../api/queries';
import { errorMessage } from '../lib/errors';
import { isIos, isStandalone, useInstall } from '../lib/install';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { Icon } from './Icon';
import { ErrorState, LoadingList, Spinner } from './States';
import { useToast } from './Toasts';

/** Install the app (Android/desktop prompt, or iPhone instructions). */
export function InstallApp() {
  const { t } = useTranslation();
  const { canPrompt, install } = useInstall();
  if (isStandalone()) return <p className="muted">{t('install.installed')}</p>;
  if (canPrompt)
    return (
      <button
        type="button"
        className="btn btn--secondary"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void install()}
      >
        <Icon name="download" size={18} />
        {t('install.button')}
      </button>
    );
  return <p className="muted">{isIos() ? t('install.ios') : t('install.other')}</p>;
}

function PushDevice() {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then((s) =>
      setState(isIos() && !isStandalone() && s === 'unsupported' ? 'needs-install' : s),
    );
  }, []);
  if (state === null) return null;
  if (state === 'unsupported' || state === 'needs-install')
    return <p className="muted">{isIos() ? t('push.iosInstall') : t('push.unsupported')}</p>;
  if (state === 'denied') return <p className="muted">{t('push.denied')}</p>;
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span>{state === 'on' ? t('push.onHere') : t('push.offHere')}</span>
      <button
        type="button"
        className={`btn btn--small ${state === 'on' ? 'btn--secondary' : 'btn--primary'}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setState(state === 'on' ? await disablePush() : await enablePush());
          } catch (err) {
            toast(errorMessage(err, t), { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        {state === 'on' ? t('push.turnOff') : t('push.turnOn')}
      </button>
    </div>
  );
}

/** A switch per type and channel (on by default). */
export function NotificationSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const prefs = useNotificationPrefs();
  const set = useSetNotificationPref();
  if (prefs.isPending) return <LoadingList rows={3} />;
  if (prefs.isError)
    return (
      <ErrorState message={errorMessage(prefs.error, t)} onRetry={() => void prefs.refetch()} />
    );
  const d = prefs.data;
  const enabled = (type: string, channel: string) =>
    d.preferences.find((p) => p.type === type && p.channel === channel)?.enabled ?? true;
  const channels = NOTIFICATION_CHANNELS.filter(
    (c) => (c !== 'push' || d.pushAvailable) && (c !== 'email' || d.emailAvailable),
  );
  return (
    <div className="stack-lg">
      {d.pushAvailable && <PushDevice />}
      <table className="prefs">
        <caption className="visually-hidden">{t('notifySettings.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('notifySettings.type')}</th>
            {channels.map((c) => (
              <th key={c} scope="col">
                {t(`notifySettings.channels.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_TYPES.map((type) => (
            <tr key={type}>
              <th scope="row">{t(`notifySettings.types.${type}`)}</th>
              {channels.map((channel) => (
                <td key={channel}>
                  <input
                    type="checkbox"
                    className="prefs__check"
                    checked={enabled(type, channel)}
                    aria-label={`${t(`notifySettings.types.${type}`)}: ${t(`notifySettings.channels.${channel}`)}`}
                    onChange={(e) =>
                      set.mutate(
                        { type, channel, enabled: e.target.checked },
                        { onError: (err) => toast(errorMessage(err, t), { tone: 'error' }) },
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!d.emailAvailable && <p className="field__hint">{t('notifySettings.noEmail')}</p>}
    </div>
  );
}
