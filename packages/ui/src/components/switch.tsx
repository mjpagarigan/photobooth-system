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
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-[checked]:bg-primary bg-secondary',
        className,
      )}
      ref={ref}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-foreground shadow-lg ring-0 transition-transform',
          'data-[checked]:translate-x-5 translate-x-0',
        )}
      />
    </BaseSwitch.Root>
  );
});
