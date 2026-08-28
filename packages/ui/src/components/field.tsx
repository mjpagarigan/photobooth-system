import { Field as BaseField } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Field = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseField.Root>
>(function Field({ className, ...props }, ref) {
  return (
    <BaseField.Root
      className={cn('flex flex-col gap-1.5', className)}
      ref={ref}
      {...props}
    />
  );
});

export const FieldLabel = forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<typeof BaseField.Label>
>(function FieldLabel({ className, ...props }, ref) {
  return (
    <BaseField.Label
      className={cn('font-sans text-xs font-semibold tracking-wide text-foreground uppercase select-none', className)}
      ref={ref}
      {...props}
    />
  );
});

export const FieldDescription = forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseField.Description>
>(function FieldDescription({ className, ...props }, ref) {
  return (
    <BaseField.Description
      className={cn('text-xs text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export const FieldError = forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseField.Error>
>(function FieldError({ className, ...props }, ref) {
  return (
    <BaseField.Error
      className={cn('text-xs font-medium text-destructive', className)}
      ref={ref}
      {...props}
    />
  );
});

export const FieldValidity = BaseField.Validity;
