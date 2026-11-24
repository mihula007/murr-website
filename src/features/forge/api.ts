import { useInfiniteQuery } from '@tanstack/react-query'
import type {
  ForgeCatalogKind,
  ForgeCatalogItem,
} from '../../../shared/forge/catalogs'
import type { ForgeCatalogResponse } from '@contracts/forge'
import { callApi } from '@/lib/supabase/api'

export function useForgeCatalog(
  kind: ForgeCatalogKind,
  search: string,
  slot?: string,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ['forge', 'catalog', kind, search, slot],
    queryFn: ({ pageParam }) =>
      callApi<ForgeCatalogResponse>('forge/catalog', {
        kind,
        search,
        ...(slot ? { slot } : {}),
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    select: (data) =>
      data.pages.flatMap((page): ForgeCatalogItem[] => page.items),
  })
}
