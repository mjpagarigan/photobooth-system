import { Dialog as BaseDialog } from '@base-ui/react';
import { XIcon as X } from '@phosphor-icons/react';
import React, { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export type DialogPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseDialog.Portal>;
  showCloseButton?: boolean;
  onClose?: () => void;
  maxWidthClass?: string;
} & React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>

export const DialogPopup = forwardRef<HTMLDivElement, DialogPopupProps>(function DialogPopup(
  {
    children,
    className,
    portalProps,
    showCloseButton = true,
    onClose,
    maxWidthClass = 'max-w-lg',
    ...props
  },
  ref,
) {
  return (
    <BaseDialog.Portal {...portalProps}>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm transition-opacity duration-200" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <BaseDialog.Popup
          className={cn(
            'relative flex w-full flex-col rounded-xl border border-border bg-card text-card-foreground shadow-2xl transition-all duration-200 focus-visible:outline-none',
            maxWidthClass,
            className,
          )}
          ref={ref}
          {...props}
        >
          {showCloseButton && (
            <BaseDialog.Close
              aria-label="Close dialog"
              className="absolute top-4 right-4 z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
              onClick={onClose}
              render={<button type="button" />}
            >
              <X aria-hidden="true" className="size-5" weight="bold" />
            </BaseDialog.Close>
          )}
          {children}
        </BaseDialog.Popup>
      </div>
    </BaseDialog.Portal>
  );
});

export function DialogHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 p-6 border-b border-border/40', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <BaseDialog.Title
      className={cn('font-heading text-lg font-bold tracking-tight text-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <BaseDialog.Description
      className={cn('text-sm text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export function DialogPanel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-6', className)} {...props}>
      {children}
    </div>
  );
}

export function DialogFooter({
  className,
  variant = 'default',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'bare' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 p-6',
        variant === 'default' && 'border-t border-border/40 bg-surface-tint/30 rounded-b-xl',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
