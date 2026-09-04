import { Progress as BaseProgress } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const ProgressLabel = BaseProgress.Label;
export const ProgressValue = BaseProgress.Value;

export type ProgressProps = {
  indicatorClassName?: string;
} & React.ComponentPropsWithoutRef<typeof BaseProgress.Root>;

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { className, indicatorClassName, value, children, ...props },
  ref,
) {
  return (
    <BaseProgress.Root
      className={cn('flex w-full flex-col gap-1.5 text-sm leading-5', className)}
      ref={ref}
      value={value}
      {...props}
    >
      {children}
      <BaseProgress.Track className="relative h-0.5 w-full overflow-hidden bg-[#e0e0e0]">
        <BaseProgress.Indicator
          className={cn(
            'h-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none',
            indicatorClassName,
          )}
          style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
});
