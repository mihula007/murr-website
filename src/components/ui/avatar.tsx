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
    <AvatarPrimitive.Root className={cn('guild-avatar', className)} {...props}>
      {src ? (
        <AvatarPrimitive.Image
          className="guild-avatar-image"
          src={src}
          alt={name}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className="guild-avatar-fallback"
        delayMs={src ? 300 : undefined}
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
