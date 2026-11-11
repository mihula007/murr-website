import type { ComponentProps } from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Первая буква имени для аватара без изображения; без имени — «?». */
export function avatarInitial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase('ru') || '?'
}

/**
 * Размеры: `sm` — 40 px (списки, меню), `md` — 72 px (выбор фото в форме),
 * `lg` — 76 px (фото профиля в кабинете).
 */
export const avatarVariants = cva(
  'relative inline-flex flex-none overflow-hidden rounded-full border bg-secondary',
  {
    variants: {
      size: {
        sm: 'size-10 border-border-accent',
        md: 'size-[72px] border-border text-2xl',
        lg: 'size-[76px] border-border text-2xl',
      },
    },
    defaultVariants: { size: 'sm' },
  },
)

type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> &
  VariantProps<typeof avatarVariants> & {
    /** Имя: первая буква — запасной вариант, полностью — для скринридера. */
    name: string
    src?: string | null | undefined
    /** Подпись изображения; по умолчанию — имя. */
    alt?: string
  }

/** Единственный аватар приложения: изображение или первая буква имени. */
export function Avatar({
  name,
  src,
  alt,
  size,
  className,
  ...props
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(avatarVariants({ size }), className)}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image
          className="size-full object-cover"
          src={src}
          alt={alt ?? name}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className="grid size-full place-items-center font-extrabold text-primary"
        delayMs={src ? 300 : undefined}
      >
        <span aria-hidden="true">{avatarInitial(name)}</span>
        {name ? <span className="sr-only">{name}</span> : null}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
