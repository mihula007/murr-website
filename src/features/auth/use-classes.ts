import { useQuery } from '@tanstack/react-query'
import type { ClassesResponse } from '@contracts/catalog'
import { callApi } from '@/lib/api/client'

export function useClasses() {
  return useQuery({
    queryKey: ['catalog', 'classes'],
    queryFn: () => callApi<ClassesResponse>('catalog/classes'),
    staleTime: Infinity,
    select: (data) => data.classes,
  })
}
