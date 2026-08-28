import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        aria-hidden="true"
        className={cn('animate-pulse rounded-md bg-secondary/80', className)}
        ref={ref}
        {...props}
      />
    );
  },
);
