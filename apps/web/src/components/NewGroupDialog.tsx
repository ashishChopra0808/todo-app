import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LIMITS } from '@todo/shared';
import { useCreateGroup } from '../api/queries';
import { errorMessage, fieldErrors } from '../lib/errors';
import { Dialog } from './Dialog';
import { FormError, TextField } from './Field';
import { Spinner } from './States';
import { useToast } from './Toasts';

/** A short, friendly set: tapping is easier than typing an emoji, and it keeps icons valid. */
export const GROUP_ICONS = ['🏠', '👨‍👩‍👧', '💼', '🏢', '🛒', '🎉', '🏫', '⚽', '🌱', '🍳', '🐾', '✈️'];

export function IconPicker({
  value,
  onChange,
  name,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="fieldset">
      <legend className="field__label">{t('groups.create.icon')}</legend>
      <div className="chips">
        <label className="chip">
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <span>{t('groups.create.noIcon')}</span>
        </label>
        {GROUP_ICONS.map((icon) => (
          <label key={icon} className="chip chip--emoji">
            <input
              type="radio"
              name={name}
              checked={value === icon}
              onChange={() => onChange(icon)}
              aria-label={icon}
            />
            <span aria-hidden="true">{icon}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "New group" form in a dialog; opens the new group when done. */
export function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateGroup();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFields({ name: t('errors.field.required') });
      return;
    }
    setFields({});
    setError(null);
    try {
      const g = await create.mutateAsync({ name, icon });
      toast(t('groups.create.done'));
      setName('');
      setIcon(null);
      onClose();
      await navigate({ to: '/groups/$id', params: { id: g.id }, search: { invite: '1' } });
    } catch (err) {
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('groups.create.title')}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label={t('groups.create.name')}
          placeholder={t('groups.create.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.groupName}
          error={fields.name}
          autoFocus
          autoComplete="off"
        />
        <IconPicker value={icon} onChange={setIcon} name="new-group-icon" />
        <FormError message={error} />
        <div className="modal__actions">
          <button type="submit" className="btn btn--primary btn--block" disabled={create.isPending}>
            {create.isPending && <Spinner />}
            {t('groups.create.submit')}
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
