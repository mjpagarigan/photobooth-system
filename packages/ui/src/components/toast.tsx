import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils';

export type ToastItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error';
  duration?: number;
}

type ToastContextType = {
  toasts: ToastItem[];
  add: (options: Omit<ToastItem, 'id'> & { id?: string }) => string;
  remove: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

let globalToastContext: ToastContextType | null = null;

export const toastManager = {
  add(options: Omit<ToastItem, 'id'> & { id?: string }): string {
    if (globalToastContext) {
      return globalToastContext.add(options);
    }
    return '';
  },
  remove(id: string): void {
    if (globalToastContext) {
      globalToastContext.remove(id);
    }
  },
};

export const anchoredToastManager = toastManager;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    (options: Omit<ToastItem, 'id'> & { id?: string }) => {
      const id = options.id ?? Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { ...options, id };
      setToasts((prev) => [...prev.filter((t) => t.id !== id), newToast]);

      const duration = options.duration ?? 4000;
      if (duration > 0) {
        setTimeout(() => remove(id), duration);
      }
      return id;
    },
    [remove],
  );

  const value = useMemo(() => ({ toasts, add, remove }), [toasts, add, remove]);

  useEffect(() => {
    globalToastContext = value;
    return () => {
      globalToastContext = null;
    };
  }, [value]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full"
      >
        {toasts.map((toast) => (
          <div
            className={cn(
              'pointer-events-auto flex flex-col gap-1 rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2',
              toast.variant === 'success' && 'border-success/50 bg-card text-foreground',
              toast.variant === 'error' && 'border-destructive/50 bg-card text-foreground',
              toast.variant === 'warning' && 'border-[#d97706]/50 bg-card text-foreground',
              (!toast.variant || toast.variant === 'default') &&
                'border-border/50 bg-card text-foreground',
            )}
            key={toast.id}
          >
            <div className="font-heading text-sm font-bold tracking-tight">{toast.title}</div>
            {toast.description && (
              <div className="text-xs text-muted-foreground leading-relaxed">
                {toast.description}
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function AnchoredToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
