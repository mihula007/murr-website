import type { ComponentProps } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-border',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative flex-none cursor-pointer border-0 bg-transparent px-[13px] py-2.5 font-semibold text-muted-foreground hover:text-highlight data-[state=active]:text-highlight data-[state=active]:after:absolute data-[state=active]:after:inset-x-[13px] data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-sm data-[state=active]:after:bg-linear-90/srgb data-[state=active]:after:from-transparent data-[state=active]:after:via-highlight-line data-[state=active]:after:to-transparent data-[state=active]:after:drop-shadow-glow',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4', className)} {...props} />
}
