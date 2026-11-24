import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { authApi } from '../lib/auth-api';

export function usePublicConfig() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: authApi.publicConfig,
    staleTime: Infinity,
  });
}

/**
 * Staging only: text messages (codes and invites) go to the team's email inbox, not the phone.
 * Without this note, people wait for an SMS that never comes. Renders nothing in production.
 */
export function StagingSmsNote({ kind, block }: { kind: 'code' | 'invite'; block?: boolean }) {
  const { t } = useTranslation();
  const cfg = usePublicConfig();
  if (!cfg.data?.smsToEmail) return null;
  const text = kind === 'code' ? t('staging.smsCode') : t('staging.smsInvite');
  return block ? (
    <p className="staging-note">{text}</p>
  ) : (
    <span className="staging-note">{text}</span>
  );
}
