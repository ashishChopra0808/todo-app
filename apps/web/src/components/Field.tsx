import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  labelHidden?: boolean;
}

/** Label + control + hint + error, wired up with aria-describedby / aria-invalid. */
export function Field({ label, hint, error, children, labelHidden }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className={labelHidden ? 'visually-hidden' : 'field__label'}>
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  labelHidden?: boolean;
};

export function TextField({ label, hint, error, labelHidden, className, ...input }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} labelHidden={labelHidden}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={className ?? 'input'}
          {...input}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  labelHidden,
  className,
  ...input
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  labelHidden?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} labelHidden={labelHidden}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={className ?? 'input'}
          {...input}
        />
      )}
    </Field>
  );
}

export function PasswordField({ label, hint, error, ...input }: Omit<InputProps, 'type'>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="input-wrap">
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="input"
            autoCapitalize="off"
            spellCheck={false}
            {...input}
          />
          <button
            type="button"
            className="input-wrap__action"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            aria-controls={id}
          >
            {visible ? t('common.hide') : t('common.show')}
          </button>
        </div>
      )}
    </Field>
  );
}

interface SegmentedProps<T extends string> {
  legend: ReactNode;
  legendHidden?: boolean;
  name: string;
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}

/** Radio group styled as a segmented control. Arrow keys move between options natively. */
export function Segmented<T extends string>({
  legend,
  legendHidden,
  name,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="fieldset">
      <legend className={legendHidden ? 'visually-hidden' : 'section-title'}>{legend}</legend>
      <div className="segmented" role="presentation">
        {options.map((o) => (
          <label key={o.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="form-error" role="alert">
      {message}
    </div>
  );
}
