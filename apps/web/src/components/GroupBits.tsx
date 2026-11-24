import { useTranslation } from 'react-i18next';
import type { GroupRef, PersonRef } from '@todo/shared';
import { Icon } from './Icon';

/** The group's emoji, or a neutral people icon. Decorative: the name is always shown next to it. */
export function GroupIcon({
  group,
  size = 'md',
}: {
  group: Pick<GroupRef, 'icon'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`group-icon group-icon--${size}`} aria-hidden="true">
      {group.icon ?? <Icon name="users" size={size === 'sm' ? 14 : size === 'lg' ? 28 : 20} />}
    </span>
  );
}

/** Small photo or initial. Decorative unless `label` is given. */
export function MiniAvatar({
  person,
  label,
  size = 24,
}: {
  person: Pick<PersonRef, 'name' | 'avatarUrl'>;
  label?: string;
  size?: number;
}) {
  const initial = (person.name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className="mini-avatar"
      style={{ inlineSize: size, blockSize: size, fontSize: Math.round(size * 0.45) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        initial
      )}
    </span>
  );
}

/** Overlapping avatars of a few members, with a screen-reader summary. */
export function AvatarStack({ people, total }: { people: PersonRef[]; total: number }) {
  const { t } = useTranslation();
  const extra = total - people.length;
  return (
    <span className="avatar-stack" role="img" aria-label={t('groups.members', { count: total })}>
      {people.map((p) => (
        <MiniAvatar key={p.id} person={p} size={28} />
      ))}
      {extra > 0 && (
        <span className="mini-avatar mini-avatar--more" aria-hidden="true">
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Radio chips for narrowing a list (Today's group filter, the group page's All · Mine · Unassigned). */
export function FilterChips<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: string | null; isGroup?: boolean }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="fieldset">
      <legend className="visually-hidden">{legend}</legend>
      <div className="chips chips--scroll">
        {options.map((o) => (
          <label key={o.value} className="chip chip--small">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>
              {o.isGroup && <GroupIcon group={{ icon: o.icon ?? null }} size="sm" />}
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
