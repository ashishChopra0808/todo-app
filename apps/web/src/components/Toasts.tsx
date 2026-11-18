import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<(message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>) => void>(
  () => undefined,
);

/** Toasts are announced politely to screen readers (errors assertively) and auto-dismiss. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) => {
    const id = next.current++;
    setToasts((ts) => [
      ...ts.slice(-2),
      { id, message, tone: opts.tone ?? 'info', action: opts.action },
    ]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), opts.action ? 10000 : 5000);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {toasts
          .filter((t) => t.tone === 'info')
          .map((t) => (
            <div key={t.id} className="toast">
              <span>{t.message}</span>
              {t.action && <button onClick={t.action.onClick}>{t.action.label}</button>}
            </div>
          ))}
      </div>
      <div className="toasts" aria-live="assertive" role="alert">
        {toasts
          .filter((t) => t.tone === 'error')
          .map((t) => (
            <div key={t.id} className="toast toast--error">
              <span>{t.message}</span>
            </div>
          ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
