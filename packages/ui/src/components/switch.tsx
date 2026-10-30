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
        'peer inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-0 focus-visible:shadow-[0_0_0_3px_#0066cc] disabled:cursor-not-allowed disabled:border-[#aeaeb2] disabled:bg-[#e8e8ed]',
        'border-[#636366] bg-white hover:border-[#1d1d1f] data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:hover:bg-[#0071e3]',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block size-3.5 rounded-full transition-transform',
          'translate-x-0.5 bg-[#636366] data-[checked]:translate-x-[22px] data-[checked]:bg-white group-disabled:bg-[#aeaeb2]',
        )}
      />
    </BaseSwitch.Root>
  );
});
