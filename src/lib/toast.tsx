import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Lightweight toast system. Drives the "destructive action + Annuler" pattern
// that replaces the native confirm() dialogs across the app.

interface Toast {
  id: string;
  message: string;
  undo?: () => void;
  ttl: number;
  variant: 'default' | 'danger';
}

interface ShowOptions {
  message: string;
  undo?: () => void;
  ttl?: number;
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
      const ttl = opts.ttl ?? DEFAULT_TTL;
      const toast: Toast = {
        id,
        message: opts.message,
        undo: opts.undo,
        ttl,
        variant: opts.variant ?? 'default',
      };
      setToasts((prev) => [...prev, toast]);
      const timer = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, timer);
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
  return (
    <div className={`toast toast-${toast.variant}`} style={{ ['--toast-ttl' as string]: `${toast.ttl}ms` }}>
      <span className="toast-msg">{toast.message}</span>
      {toast.undo && (
        <button type="button" className="toast-undo" onClick={handleUndo}>
          Annuler
        </button>
      )}
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Fermer">
        ✕
      </button>
      <span className="toast-progress" aria-hidden="true" />
    </div>
  );
}
