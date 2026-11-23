import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Icon, type IconName } from './Icon';

export interface MoreAction {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  onAction: () => void;
}

/** "⋯" button with a keyboard-accessible menu (arrow keys, Escape, focus returns to the button). */
export function MoreMenu({ label, actions }: { label: string; actions: MoreAction[] }) {
  if (!actions.length) return null;
  return (
    <MenuTrigger>
      <Button className="icon-btn" aria-label={label}>
        <Icon name="more" size={22} />
      </Button>
      <Popover className="menu-popover" placement="bottom end" offset={4}>
        <Menu
          className="stack"
          style={{ gap: 0, outline: 'none' }}
          onAction={(key) => actions.find((a) => a.id === key)?.onAction()}
        >
          {actions.map((a) => (
            <MenuItem
              key={a.id}
              id={a.id}
              textValue={a.label}
              className={`menu-item${a.danger ? ' menu-item--danger' : ''}`}
            >
              {a.icon && <Icon name={a.icon} size={18} />}
              {a.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
