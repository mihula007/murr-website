import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent font-bold transition-[filter,background] duration-180 not-disabled:hover:brightness-112 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-button-primary-border bg-linear-135/srgb from-button-primary-from to-button-primary-to text-primary-foreground',
        secondary:
          'border-button-secondary-border bg-linear-135/srgb from-button-secondary-from to-button-secondary-to text-button-secondary-foreground',
        outline: 'border-primary bg-transparent text-primary',
        ghost: 'bg-transparent text-foreground not-disabled:hover:bg-accent',
      },
      size: {
        default: 'px-4 py-2.5',
        sm: 'px-3 py-1.5 text-xs',
        icon: 'size-[42px] p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/** Текстовая кнопка-ссылка: подчёркнутый приглушённый текст, золотой при наведении. */
export const linkButtonClass =
  'cursor-pointer border-0 bg-transparent px-0.5 py-1 text-muted-foreground underline underline-offset-3 hover:text-primary'

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}
