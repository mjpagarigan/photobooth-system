import { Dialog as BaseDialog } from '@base-ui/react';
import { Dismiss20Regular } from '@fluentui/react-icons';
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
} & React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>;

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
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(245,245,247,0.6)] backdrop-blur-md transition-opacity duration-100 motion-reduce:transition-none" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <BaseDialog.Popup
          className={cn(
            'pointer-events-auto relative flex w-full flex-col gap-2 rounded-[24px] bg-white p-7 text-[#1d1d1f] shadow-[var(--shadow-64)] transition-opacity duration-100 focus-visible:outline-none motion-reduce:transition-none',
            maxWidthClass,
            className,
          )}
          ref={ref}
          {...props}
        >
          {showCloseButton && (
            <BaseDialog.Close
              aria-label="Close dialog"
              className="absolute top-5 right-5 z-10 grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[#424245] transition-colors hover:bg-[#f5f5f7] active:bg-[#e8e8ed] focus-visible:outline-2 focus-visible:outline-white focus-visible:shadow-[0_0_0_3px_#0066cc]"
              onClick={onClose}
              render={<button type="button" />}
            >
              <Dismiss20Regular aria-hidden="true" />
            </BaseDialog.Close>
          )}
          {children}
        </BaseDialog.Popup>
      </div>
    </BaseDialog.Portal>
  );
});

export function DialogHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 pr-10', className)} {...props}>
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
      className={cn(
        'font-heading text-2xl font-bold leading-tight tracking-[-0.02em] text-[#1d1d1f]',
        className,
      )}
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
      className={cn('text-sm leading-5 text-[#424245]', className)}
      ref={ref}
      {...props}
    />
  );
});

export function DialogPanel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto py-1 text-sm leading-5 text-[#1d1d1f]', className)}
      {...props}
    >
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
        'flex items-center justify-end gap-2 pt-1',
        variant === 'default' && 'bg-white',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
