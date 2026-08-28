import { Progress as BaseProgress } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const ProgressLabel = BaseProgress.Label;
export const ProgressValue = BaseProgress.Value;

export type ProgressProps = {
  indicatorClassName?: string;
} & React.ComponentPropsWithoutRef<typeof BaseProgress.Root>

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { className, indicatorClassName, value, children, ...props },
  ref,
) {
  return (
    <BaseProgress.Root
      className={cn('flex flex-col gap-1.5 w-full', className)}
      ref={ref}
      value={value}
      {...props}
    >
      {children}
      <BaseProgress.Track className="relative h-2 w-full overflow-hidden rounded-full bg-secondary/80 border border-border/40">
        <BaseProgress.Indicator
          className={cn(
            'h-full bg-primary transition-all duration-300 ease-in-out',
            indicatorClassName,
          )}
          style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
});
