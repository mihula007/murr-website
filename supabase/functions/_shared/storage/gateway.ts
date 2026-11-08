import { createClient } from '@supabase/supabase-js'

export type StoredFile = { size: number; head: Uint8Array }

/** Операции Storage, которые сервисы выполняют от имени сервера. */
export type StorageGateway = {
  createUploadUrl(
    bucket: string,
    path: string,
  ): Promise<{ path: string; token: string }>
  read(bucket: string, path: string): Promise<StoredFile | null>
  list(bucket: string, folder: string): Promise<string[]>
  remove(bucket: string, paths: string[]): Promise<void>
  signedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string | null>
}

export function createStorageGateway(
  supabaseUrl: string,
  serviceKey: string,
): StorageGateway {
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async createUploadUrl(bucket, path) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUploadUrl(path)
      if (error || !data) throw error ?? new Error('Нет ссылки загрузки')
      return { path: data.path, token: data.token }
    },
    async read(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path)
      if (error || !data) return null
      const bytes = new Uint8Array(await data.arrayBuffer())
      return { size: bytes.byteLength, head: bytes.slice(0, 16) }
    },
    async list(bucket, folder) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: 100 })
      if (error) throw error
      return (data ?? []).map((item) => `${folder}/${item.name}`)
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return
      const { error } = await client.storage.from(bucket).remove(paths)
      if (error) throw error
    },
    async signedUrl(bucket, path, expiresInSeconds) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds)
      return error || !data ? null : data.signedUrl
    },
  }
}
