import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LIMITS, REPORT_REASONS, type ReportReason, type ReportTarget } from '@todo/shared';
import { useReport } from '../api/queries';
import { errorMessage } from '../lib/errors';
import { Dialog } from './Dialog';
import { FormError, TextArea } from './Field';
import { Spinner } from './States';
import { useToast } from './Toasts';

export interface ReportTargetRef {
  type: ReportTarget;
  id: string;
  /** Shown in the title, e.g. the person's name. */
  label?: string;
  groupId?: string;
}

/** Report a task, comment, member or group. Says plainly what happens next. */
export function ReportDialog({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: ReportTargetRef;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) {
      setMissing(true);
      return;
    }
    setError(null);
    try {
      await report.mutateAsync({
        targetType: target.type,
        targetId: target.id,
        groupId: target.groupId,
        reason,
        details: details || null,
      });
      toast(t('report.sent'));
      setReason(null);
      setDetails('');
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(`report.title.${target.type}`, { name: target.label ?? '' })}
    >
      <form className="form" onSubmit={submit} noValidate>
        <fieldset
          className="fieldset"
          aria-describedby={missing ? 'report-reason-error' : undefined}
          aria-invalid={missing || undefined}
        >
          <legend className="field__label">{t('report.reason')}</legend>
          <div className="radio-list">
            {REPORT_REASONS.map((r) => (
              <label key={r} className="check">
                <input
                  type="radio"
                  name="report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => {
                    setReason(r);
                    setMissing(false);
                  }}
                />
                <span>{t(`report.reasons.${r}`)}</span>
              </label>
            ))}
          </div>
          {missing && (
            <p id="report-reason-error" className="field__error">
              {t('report.pickReason')}
            </p>
          )}
        </fieldset>
        <TextArea
          label={
            <>
              {t('report.details')} <span className="meta">({t('common.optional')})</span>
            </>
          }
          rows={3}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={LIMITS.reportDetails}
        />
        <p className="muted" style={{ fontSize: 14 }}>
          {t('report.next')}
        </p>
        <FormError message={error} />
        <div className="modal__actions">
          <button type="submit" className="btn btn--primary btn--block" disabled={report.isPending}>
            {report.isPending && <Spinner />}
            {t('report.submit')}
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
