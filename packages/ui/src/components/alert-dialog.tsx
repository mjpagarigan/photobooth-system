import { AlertDialog as BaseAlertDialog } from '@base-ui/react';
import React, { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

export type AlertDialogPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Portal>;
  maxWidthClass?: string;
} & React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Popup>

export const AlertDialogPopup = forwardRef<HTMLDivElement, AlertDialogPopupProps>(
  function AlertDialogPopup(
    { children, className, portalProps, maxWidthClass = 'max-w-md', ...props },
    ref,
  ) {
    return (
      <BaseAlertDialog.Portal {...portalProps}>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm transition-opacity duration-200" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <BaseAlertDialog.Popup
            className={cn(
              'relative flex w-full flex-col rounded-xl border border-destructive/50 bg-card text-card-foreground shadow-2xl transition-all duration-200 focus-visible:outline-none',
              maxWidthClass,
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </BaseAlertDialog.Popup>
        </div>
      </BaseAlertDialog.Portal>
    );
  },
);

export function AlertDialogHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-2 p-6', className)} {...props}>
      {children}
    </div>
  );
}

export const AlertDialogTitle = forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <BaseAlertDialog.Title
      className={cn('font-heading text-lg font-bold tracking-tight text-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export const AlertDialogDescription = forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <BaseAlertDialog.Description
      className={cn('text-sm text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export function AlertDialogFooter({
  className,
  variant = 'default',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'bare' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 p-6 pt-0',
        variant === 'default' && 'mt-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
