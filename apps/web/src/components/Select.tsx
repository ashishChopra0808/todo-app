import type { Key } from 'react-aria-components';
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components';
import { Icon } from './Icon';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Set for options written in another script, e.g. हिन्दी, so screen readers pronounce them right. */
  lang?: string;
};

/**
 * Dropdown drawn by the app rather than the browser, so the open list looks the same in
 * Chrome, Safari, Firefox and Edge, in light and dark themes. React Aria keeps it a proper
 * listbox: arrow keys, type-to-search, Escape, and screen-reader labels all work.
 */
export function Select<T extends string>({
  label,
  hideLabel = false,
  description,
  value,
  onChange,
  options,
  variant = 'field',
  className,
}: {
  label: string;
  /** Keep the label for screen readers only (compact pickers in page headers). */
  hideLabel?: boolean;
  description?: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  /** `field`: full-width form control. `pill`: compact rounded picker. */
  variant?: 'field' | 'pill';
  className?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <AriaSelect
      value={value}
      onChange={(key: Key | null) => {
        if (key != null && key !== value) onChange(String(key) as T);
      }}
      aria-label={hideLabel ? label : undefined}
      className={['select', `select--${variant}`, variant === 'field' ? 'field' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {!hideLabel && <Label className="field__label">{label}</Label>}
      <Button className="select__button">
        <SelectValue className="select__value" lang={selected?.lang} />
        <Icon name="chevronDown" size={18} className="select__chevron" />
      </Button>
      {description && (
        <Text slot="description" className="field__hint">
          {description}
        </Text>
      )}
      <Popover className="select__popover" offset={6}>
        <ListBox className="select__list" items={options.map((o) => ({ ...o, id: o.value }))}>
          {(o) => (
            <ListBoxItem id={o.value} textValue={o.label} lang={o.lang} className="select__item">
              {({ isSelected }) => (
                <>
                  <span className="select__item-label">{o.label}</span>
                  {isSelected && <Icon name="check" size={16} className="select__check" />}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
