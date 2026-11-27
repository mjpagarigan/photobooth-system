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
        'aspect-square size-[18px] cursor-pointer rounded-full border border-[#d2d2d7] bg-white text-white shadow-none transition-colors hover:border-[#86868b] focus:outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary flex items-center justify-center',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseRadio.Indicator className="flex items-center justify-center">
        <span className="size-2 rounded-full bg-white" />
      </BaseRadio.Indicator>
    </BaseRadio.Root>
  );
});
