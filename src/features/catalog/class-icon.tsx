import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useClasses } from './use-classes'

/** Иконки классов из прототипа, уменьшенные до 104 px: slug → адрес. */
const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('@/assets/class-icons/*.webp', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  ).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]),
)

/** Буквы вместо иконки: две первые буквы названия класса. */
export function classAbbreviation(name: string) {
  return name.replace(/\s+/g, '').slice(0, 2).toUpperCase()
}

type ClassIconProps = {
  classId: number
  className: string
  /** Классы обёртки: размер задаётся утилитами `size-*`. */
  wrapperClassName?: string
}

/**
 * Иконка класса из единого справочника (ROS-09). Без иконки или при ошибке
 * загрузки — сокращение названия; само название класса выводится рядом
 * и не зависит от иконки. Для чтения с экрана иконка скрыта.
 */
export function ClassIcon({
  classId,
  className,
  wrapperClassName,
}: ClassIconProps) {
  const classes = useClasses()
  const [failed, setFailed] = useState(false)
  const slug = classes.data?.find((item) => item.id === classId)?.slug
  const src = slug ? ICONS[slug] : undefined
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid size-[26px] flex-none place-items-center overflow-hidden rounded-full border border-border-accent bg-linear-145/srgb from-surface-from to-surface-to text-[9px] leading-none font-extrabold text-tag-foreground',
        wrapperClassName,
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        classAbbreviation(className)
      )}
    </span>
  )
}
