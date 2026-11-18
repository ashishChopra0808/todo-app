import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

/** Accessible modal: traps focus, closes on Escape, restores focus to the trigger. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  role = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(o) => !o && onClose()}
      isDismissable
      className="modal-overlay"
    >
      <Modal className="modal">
        <AriaDialog role={role} className="stack" style={{ outline: 'none' }}>
          <Heading slot="title" className="modal__title">
            {title}
          </Heading>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
