import { Switch as BaseSwitch } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Switch = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <BaseSwitch.Root
      className={cn(
        'peer inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer items-center rounded-full border-0 bg-[#e5e5ea] p-[2px] transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-[checked]:bg-[#34c759] data-[checked]:hover:bg-[#2eb850] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block size-[24px] translate-x-0 rounded-full bg-white shadow-[var(--shadow-switch-thumb)] transition-transform data-[checked]:translate-x-[20px]',
        )}
      />
    </BaseSwitch.Root>
  );
});
