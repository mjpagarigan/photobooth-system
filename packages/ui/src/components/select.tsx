import { Select as BaseSelect } from '@base-ui/react';
import { Check, ChevronDown } from './icons';
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
        'flex h-10 min-h-[40px] w-full cursor-pointer select-none items-center justify-between gap-2 rounded-[12px] border border-[#636366] bg-white px-3 font-sans text-sm leading-5 text-[#1d1d1f] transition-[border-color,box-shadow,background-color] duration-100',
        'hover:border-[#424245] focus-visible:border-[#1d1d1f] focus-visible:outline-2 focus-visible:outline-white focus-visible:shadow-[0_0_0_3px_#0066cc]',
        'disabled:cursor-not-allowed disabled:border-[#e8e8ed] disabled:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        'data-[placeholder]:text-[#636366]',
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown aria-hidden="true" size={16} />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
});

export const SelectValue = forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Value>
>(function SelectValue({ className, ...props }, ref) {
  return (
    <BaseSelect.Value className={cn('block truncate text-left', className)} ref={ref} {...props} />
  );
});

export type SelectPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseSelect.Portal>;
  positionerProps?: React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>;
} & React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>;

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
            'z-[100] max-h-96 min-w-[var(--anchor-width,8rem)] overflow-y-auto rounded-[12px] border border-[#d2d2d7] bg-white p-1 text-[#1d1d1f] shadow-[var(--shadow-16)] transition-opacity duration-100 focus-visible:outline-none motion-reduce:transition-none',
            className,
          )}
          ref={ref}
          {...props}
        >
          <BaseSelect.List className="py-1 outline-none">{children}</BaseSelect.List>
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
        'relative flex min-h-8 w-full cursor-pointer select-none items-center rounded-[8px] py-1.5 ps-8 pe-3 text-sm font-normal leading-5 outline-none transition-colors',
        'data-[highlighted]:bg-[#f5f5f7] data-[highlighted]:text-[#1d1d1f]',
        'data-[disabled]:pointer-events-none data-[disabled]:text-[#aeaeb2]',
        className,
      )}
      ref={ref}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <Check aria-hidden="true" className="text-primary" size={16} />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
});

export function SelectLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'px-2 py-1.5 font-sans text-xs font-semibold leading-4 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export const SelectGroup = BaseSelect.Group;
export const SelectGroupLabel = BaseSelect.GroupLabel;
export const SelectSeparator = BaseSelect.Separator;
export const SelectList = BaseSelect.List;
export const SelectPositioner = BaseSelect.Positioner;
