import { Dialog as BaseDialog } from '@base-ui/react';
import { X } from './icons';
import React, { createContext, forwardRef, useContext, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export type DialogTone = 'light' | 'dark';

const DialogToneContext = createContext<DialogTone>('light');

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export type DialogPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseDialog.Portal>;
  showCloseButton?: boolean;
  onClose?: () => void;
  maxWidthClass?: string;
  tone?: DialogTone;
} & React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>;

export const DialogPopup = forwardRef<HTMLDivElement, DialogPopupProps>(function DialogPopup(
  {
    children,
    className,
    portalProps,
    showCloseButton = true,
    onClose,
    maxWidthClass = 'max-w-lg',
    tone = 'light',
    ...props
  },
  ref,
) {
  return (
    <BaseDialog.Portal {...portalProps}>
      <BaseDialog.Backdrop
        className={cn(
          'fixed inset-0 z-50 backdrop-blur-md transition-opacity duration-100 motion-reduce:transition-none',
          tone === 'dark' ? 'bg-[var(--color-dark-backdrop)]' : 'bg-[var(--color-light-backdrop)]',
        )}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <BaseDialog.Popup
          className={cn(
            'pointer-events-auto relative flex w-full flex-col gap-2 rounded-[28px] p-7 transition-opacity duration-100 focus-visible:outline-none motion-reduce:transition-none',
            tone === 'dark'
              ? 'bg-[#1c1c1e] text-white shadow-[var(--shadow-on-dark)]'
              : 'bg-white text-[#1d1d1f] shadow-[var(--shadow-64)]',
            maxWidthClass,
            className,
          )}
          data-tone={tone}
          ref={ref}
          {...props}
        >
          {showCloseButton && (
            <BaseDialog.Close
              aria-label="Close dialog"
              className={cn(
                'absolute top-5 right-5 z-10 grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
                tone === 'dark'
                  ? 'text-[#a1a1a6] hover:bg-[#2c2c2e] hover:text-white active:bg-[#3a3a3c]'
                  : 'text-[#424245] hover:bg-[#f5f5f7] active:bg-[#e8e8ed]',
              )}
              onClick={onClose}
              render={<button type="button" />}
            >
              <X aria-hidden="true" size={18} />
            </BaseDialog.Close>
          )}
          <DialogToneContext.Provider value={tone}>{children}</DialogToneContext.Provider>
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
  const tone = useContext(DialogToneContext);
  return (
    <BaseDialog.Title
      className={cn(
        'font-heading text-2xl font-bold leading-tight tracking-[-0.02em]',
        tone === 'dark' ? 'text-white' : 'text-[#1d1d1f]',
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
  const tone = useContext(DialogToneContext);
  return (
    <BaseDialog.Description
      className={cn(
        'text-sm leading-5',
        tone === 'dark' ? 'text-[#a1a1a6]' : 'text-[#424245]',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export function DialogPanel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const tone = useContext(DialogToneContext);
  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto py-1 text-sm leading-5',
        tone === 'dark' ? 'text-white' : 'text-[#1d1d1f]',
        className,
      )}
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
      className={cn('flex items-center justify-end gap-2 bg-transparent pt-1', className)}
      data-variant={variant}
      {...props}
    >
      {children}
    </div>
  );
}
