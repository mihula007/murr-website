import { useState, type PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessProvider } from '@/app/access'
import { Toaster } from '@/components/ui/toaster'
import { SessionProvider } from '@/features/auth/session'

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
          mutations: { retry: false },
        },
      }),
  )

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
