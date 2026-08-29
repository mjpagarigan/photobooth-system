import { Select as BaseSelect } from '@base-ui/react';
import { CaretDownIcon as CaretDown, CheckIcon as Check } from '@phosphor-icons/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Select = BaseSelect.Root;

export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <BaseSelect.Trigger
      className={cn(
        'flex h-11 min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3.5 py-2 font-sans text-sm text-foreground shadow-sm transition-colors cursor-pointer select-none',
        'focus-visible:outline-2 focus-visible:outline-ring focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-muted-foreground/60',
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <CaretDown aria-hidden="true" className="size-4 opacity-70" weight="bold" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
});

export const SelectValue = forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Value>
>(function SelectValue({ className, ...props }, ref) {
  return (
    <BaseSelect.Value
      className={cn('block truncate text-left', className)}
      ref={ref}
      {...props}
    />
  );
});

export type SelectPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseSelect.Portal>;
  positionerProps?: React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>;
} & React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>

export const SelectPopup = forwardRef<HTMLDivElement, SelectPopupProps>(function SelectPopup(
  { className, children, portalProps, positionerProps, ...props },
  ref,
) {
  return (
    <BaseSelect.Portal {...portalProps}>
      <BaseSelect.Positioner
        sideOffset={4}
        {...positionerProps}
        className={cn('z-[100] outline-none select-none', positionerProps?.className)}
      >
        <BaseSelect.Popup
          className={cn(
            'z-[100] min-w-[var(--anchor-width,8rem)] max-h-96 overflow-y-auto rounded-lg border border-border bg-card p-1 text-card-foreground shadow-xl transition-all duration-150 focus-visible:outline-none',
            className,
          )}
          ref={ref}
          {...props}
        >
          <BaseSelect.List className="py-1 outline-none">
            {children}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
});

export const SelectItem = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <BaseSelect.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-md py-2.5 ps-8 pe-3 text-sm font-medium outline-none transition-colors',
        'data-[highlighted]:bg-secondary data-[highlighted]:text-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <Check aria-hidden="true" className="size-4 text-primary" weight="bold" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
});

export function SelectLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2 py-1.5 font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase', className)}
      {...props}
    />
  );
}

export const SelectGroup = BaseSelect.Group;
export const SelectGroupLabel = BaseSelect.GroupLabel;
export const SelectSeparator = BaseSelect.Separator;
export const SelectList = BaseSelect.List;
export const SelectPositioner = BaseSelect.Positioner;
