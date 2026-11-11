import type { ComponentProps } from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> & {
  name: string
  src?: string
}

/** Аватар с запасным вариантом — первой буквой имени. */
export function Avatar({ name, src, className, ...props }: AvatarProps) {
  const initial = name.trim().charAt(0).toLocaleUpperCase('ru') || '?'
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex size-10 flex-none overflow-hidden rounded-full border border-border-accent bg-secondary',
        className,
      )}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image
          className="size-full object-cover"
          src={src}
          alt={name}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className="grid size-full place-items-center font-extrabold text-primary"
        delayMs={src ? 300 : undefined}
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
