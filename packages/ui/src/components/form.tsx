import { Form as BaseForm } from '@base-ui/react/form';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/utils';

export type FormProps = {
  contents?: boolean;
} & ComponentPropsWithoutRef<typeof BaseForm>;

export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  { className, contents, ...props },
  ref,
) {
  return <BaseForm className={cn(contents && 'contents', className)} ref={ref} {...props} />;
});
