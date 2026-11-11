import { useState, type PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessProvider } from '@/app/access'
import { createQueryClient } from '@/app/query-client'
import { Toaster } from '@/components/ui/toaster'
import { SessionProvider } from '@/features/auth/session'

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <AccessProvider>
          {children}
          <Toaster />
        </AccessProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}
