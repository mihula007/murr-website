import { useQuery } from '@tanstack/react-query'
import type { ClassesResponse } from '@contracts/catalog'
import { callApi } from '@/lib/supabase/api'

/** Справочник классов персонажей; неизменен в пределах сессии. */
export function useClasses() {
  return useQuery({
    queryKey: ['catalog', 'classes'],
    queryFn: () => callApi<ClassesResponse>('catalog/classes'),
    staleTime: Infinity,
    select: (data) => data.classes,
  })
}
