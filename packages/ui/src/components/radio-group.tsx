import { Radio as BaseRadio, RadioGroup as BaseRadioGroup } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const RadioGroup = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseRadioGroup>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <BaseRadioGroup
      className={cn('flex flex-col gap-2', className)}
      ref={ref}
      {...props}
    />
  );
});

export const Radio = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseRadio.Root>
>(function Radio({ className, ...props }, ref) {
  return (
    <BaseRadio.Root
      className={cn(
        'aspect-square size-4.5 rounded-full border border-border bg-card text-primary shadow-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary flex items-center justify-center cursor-pointer',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseRadio.Indicator className="flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-primary" />
      </BaseRadio.Indicator>
    </BaseRadio.Root>
  );
});
