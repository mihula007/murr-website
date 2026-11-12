import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  MaterialDetails,
  MaterialListResponse,
  MaterialStatus,
  MaterialTab,
} from '@contracts/materials'
import type {
  PublicationAttachment,
  PublicationUploadResponse,
} from '@contracts/publications'
import type { RichDocument } from '@contracts/rich-text'
import { callApi } from '@/lib/supabase/api'
import { uploadToSignedUrl } from '@/lib/supabase/uploads'
import type { MaterialSection } from './section'

/** Материал любого раздела; поля публикаций необязательны. */
export type MaterialView = MaterialDetails<string> & {
  showAuthor?: boolean
  attachments?: PublicationAttachment[]
}

export type MaterialListRequest = {
  tab: MaterialTab
  page?: number
  category?: string | null
  search?: string | null
}

export type SaveMaterialRequest = {
  id: string | null
  expectedUpdatedAt: string | null
  status: MaterialStatus
  category: string
  title: string
  summary: string | null
  content: RichDocument
  discussionEnabled: boolean
  showAuthor?: boolean
  attachments?: { path: string; fileName: string }[]
}

/** Лента или черновики; при смене страницы старая видна до ответа. */
export function useMaterialList(
  section: MaterialSection,
  request: MaterialListRequest,
) {
  return useQuery({
    queryKey: section.keys.list(request),
    queryFn: () =>
      callApi<MaterialListResponse<string>>(`${section.kind}/list`, request),
    placeholderData: keepPreviousData,
  })
}

export function useMaterial(section: MaterialSection, id: string) {
  return useQuery({
    queryKey: section.keys.detail(id),
    queryFn: () => callApi<MaterialView>(`${section.kind}/get`, { id }),
  })
}

/** Любая запись меняет карточку и ленты раздела. */
function useMaterialMutation<TVariables, TResult>(
  section: MaterialSection,
  mutationFn: (variables: TVariables) => Promise<TResult>,
  onSaved: (result: TResult, variables: TVariables) => string | null,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (result, variables) => {
      const id = onSaved(result, variables)
      if (id && result && typeof result === 'object' && 'id' in result) {
        queryClient.setQueryData(section.keys.detail(id), result)
      } else if (id) {
        queryClient.removeQueries({ queryKey: section.keys.detail(id) })
      }
      await queryClient.invalidateQueries({ queryKey: section.keys.lists })
    },
  })
}

export function useSaveMaterial(section: MaterialSection) {
  return useMaterialMutation(
    section,
    (request: SaveMaterialRequest) =>
      callApi<MaterialView>(`${section.kind}/save`, request),
    (result) => result.id,
  )
}

export function useUnpublishMaterial(section: MaterialSection) {
  return useMaterialMutation(
    section,
    (id: string) => callApi<MaterialView>(`${section.kind}/unpublish`, { id }),
    (result) => result.id,
  )
}

export function useDeleteMaterial(section: MaterialSection) {
  return useMaterialMutation(
    section,
    (id: string) =>
      callApi<{ deleted: true }>(`${section.kind}/delete`, { id }),
    (_result, id) => id,
  )
}

/** Загрузка вложения публикации по подписанной ссылке (PUB-13). */
export async function uploadPublicationImage(file: Blob) {
  const upload = await callApi<PublicationUploadResponse>(
    'publications/upload-url',
    { contentType: file.type },
  )
  await uploadToSignedUrl(upload, file, 'publication_file_invalid')
  return upload.path
}

/** Отмена редактора удаляет его новые непривязанные файлы (PUB-16). */
export function discardPublicationUploads(paths: string[]) {
  if (paths.length === 0) {
    return Promise.resolve()
  }
  return callApi('publications/discard-uploads', { paths }).then(
    () => undefined,
    () => undefined,
  )
}
