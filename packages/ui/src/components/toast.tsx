import { Toast } from '@base-ui/react/toast';
import {
  CheckCircleIcon as CheckCircle,
  InfoIcon as Info,
  SpinnerGapIcon as SpinnerGap,
  WarningCircleIcon as WarningCircle,
  WarningIcon as Warning,
} from '@phosphor-icons/react';
import type React from 'react';

import { cn } from '../lib/utils';

const icons = {
  error: WarningCircle,
  info: Info,
  loading: SpinnerGap,
  success: CheckCircle,
  warning: Warning,
} as const;

export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

function Toasts({
  portalProps,
  position,
}: {
  portalProps?: React.ComponentProps<typeof Toast.Portal>;
  position: ToastPosition;
}): React.ReactElement {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal {...portalProps}>
      <Toast.Viewport
        className={cn(
          'fixed z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 outline-none',
          position.startsWith('top') ? 'top-4' : 'bottom-4',
          position.endsWith('left') && 'left-4',
          position.endsWith('right') && 'right-4',
          position.endsWith('center') && 'left-1/2 -translate-x-1/2',
        )}
      >
        {toasts.map((toast) => {
          const Icon = toast.type ? icons[toast.type as keyof typeof icons] : null;
          return (
            <Toast.Root
              className="rounded-xl border border-border bg-card text-card-foreground shadow-2xl transition-[transform,opacity] data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:translate-y-2 data-ending-style:opacity-0"
              key={toast.id}
              swipeDirection={position.startsWith('top') ? 'up' : 'down'}
              toast={toast}
            >
              <Toast.Content className="flex min-h-14 items-start gap-3 px-4 py-3.5">
                {Icon ? (
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 size-5 shrink-0',
                      toast.type === 'loading' && 'animate-spin',
                    )}
                    weight="bold"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <Toast.Title className="font-semibold" />
                  <Toast.Description className="mt-0.5 text-sm text-muted-foreground" />
                </div>
                {toast.actionProps ? (
                  <Toast.Action className="min-h-11 rounded-md px-3 font-semibold" />
                ) : null}
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export const toastManager: ReturnType<typeof Toast.createToastManager> = Toast.createToastManager();
export const anchoredToastManager: ReturnType<typeof Toast.createToastManager> =
  Toast.createToastManager();

export type ToastProviderProps = Toast.Provider.Props & {
  portalProps?: React.ComponentProps<typeof Toast.Portal>;
  position?: ToastPosition;
};

export function ToastProvider({
  children,
  portalProps,
  position = 'bottom-right',
  ...props
}: ToastProviderProps): React.ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts {...(portalProps ? { portalProps } : {})} position={position} />
    </Toast.Provider>
  );
}

export type AnchoredToastProviderProps = Toast.Provider.Props & {
  portalProps?: React.ComponentProps<typeof Toast.Portal>;
};

export function AnchoredToastProvider({
  children,
  portalProps,
  ...props
}: AnchoredToastProviderProps): React.ReactElement {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <Toasts {...(portalProps ? { portalProps } : {})} position="bottom-center" />
    </Toast.Provider>
  );
}

export { Toast as ToastPrimitive };
