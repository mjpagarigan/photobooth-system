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
        'peer inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-0 focus-visible:shadow-[0_0_0_2px_#000] disabled:cursor-not-allowed disabled:border-[#bdbdbd] disabled:bg-[#f0f0f0]',
        'border-[#616161] bg-white hover:border-[#242424] data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:hover:bg-[#115ea3]',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block size-3.5 rounded-full transition-transform',
          'translate-x-0.5 bg-[#616161] data-[checked]:translate-x-[22px] data-[checked]:bg-white group-disabled:bg-[#bdbdbd]',
        )}
      />
    </BaseSwitch.Root>
  );
});
