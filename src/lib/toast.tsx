import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Lightweight toast system. Drives the "destructive action + Annuler" pattern
// that replaces the native confirm() dialogs across the app.

interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: string;
  key?: string;
  message: string;
  undo?: () => void;
  action?: ToastAction;
  // `null` means the toast stays until someone dismisses it. Reserved for the
  // things that must survive a trip to the coater — the update prompt, whose
  // button is worthless if it has already timed out when the operator returns.
  ttl: number | null;
  variant: 'default' | 'danger';
}

interface ShowOptions {
  message: string;
  // Identity across shows: a second toast with the same key replaces the first
  // rather than stacking under it. Used by the update prompt, which can be
  // raised again by a background check while the previous one is still up.
  key?: string;
  undo?: () => void;
  // Custom action button (e.g. "Mettre à jour"). Distinct from `undo`,
  // which is reserved for the destructive-action / Annuler pattern.
  action?: ToastAction;
  /** Milliseconds before the toast fades. `null` keeps it until dismissed. */
  ttl?: number | null;
  variant?: 'default' | 'danger';
}

interface ToastApi {
  show: (opts: ShowOptions) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const DEFAULT_TTL = 6_000;

function makeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (opts: ShowOptions) => {
      const id = makeId();
      const ttl = opts.ttl === undefined ? DEFAULT_TTL : opts.ttl;
      const toast: Toast = {
        id,
        key: opts.key,
        message: opts.message,
        undo: opts.undo,
        action: opts.action,
        ttl,
        variant: opts.variant ?? 'default',
      };
      // A keyed toast replaces the one already holding that key rather than
      // stacking a twin under it. The replaced toast's timer, if it had one,
      // is left to fire into a dismiss that finds nothing — cheaper than a
      // second map to keep in step with this one.
      setToasts((prev) => [...(opts.key ? prev.filter((t) => t.key !== opts.key) : prev), toast]);
      if (ttl != null) {
        const timer = setTimeout(() => dismiss(id), ttl);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

interface ViewportProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastViewport({ toasts, onDismiss }: ViewportProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport no-print" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  function handleUndo() {
    toast.undo?.();
    onDismiss();
  }
  function handleAction() {
    toast.action?.run();
    onDismiss();
  }
  return (
    <div
      className={`toast toast-${toast.variant}`}
      style={toast.ttl == null ? undefined : { ['--toast-ttl' as string]: `${toast.ttl}ms` }}
    >
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-undo toast-action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
      {toast.undo && (
        <button type="button" className="toast-undo" onClick={handleUndo}>
          Annuler
        </button>
      )}
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Fermer">
        ✕
      </button>
      {toast.ttl != null && <span className="toast-progress" aria-hidden="true" />}
    </div>
  );
}
