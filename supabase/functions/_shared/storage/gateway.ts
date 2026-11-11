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
  /** Пакет ссылок одним запросом: путь → ссылка; не подписанные пути отсутствуют. */
  signedUrls(
    bucket: string,
    paths: string[],
    expiresInSeconds: number,
  ): Promise<Map<string, string>>
}

const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/')

/** Storage REST API с серверным ключом; без supabase-js ради лёгкого старта функции. */
export function createStorageGateway(
  supabaseUrl: string,
  serviceKey: string,
): StorageGateway {
  const base = `${supabaseUrl}/storage/v1`
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  }
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    })
    if (!response.ok) {
      throw new Error(`Storage ${init.method ?? 'GET'} ${response.status}`)
    }
    return response
  }
  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return {
    async createUploadUrl(bucket, path) {
      const response = await call(
        `/object/upload/sign/${bucket}/${encodePath(path)}`,
        { method: 'POST' },
      )
      const { url } = (await response.json()) as { url: string }
      const token = new URL(url, base).searchParams.get('token')
      if (!token) {
        throw new Error('Нет токена загрузки')
      }
      return { path, token }
    },
    async read(bucket, path) {
      const response = await fetch(
        `${base}/object/${bucket}/${encodePath(path)}`,
        { headers },
      )
      if (!response.ok) {
        return null
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { size: bytes.byteLength, head: bytes.slice(0, 16) }
    },
    async list(bucket, folder) {
      const response = await call(
        `/object/list/${bucket}`,
        json({ prefix: folder, limit: 100, offset: 0 }),
      )
      const items = (await response.json()) as {
        name: string
        id: string | null
      }[]
      // Элементы без id — вложенные папки, а не файлы.
      return items
        .filter((item) => item.id)
        .map((item) => `${folder}/${item.name}`)
    },
    async remove(bucket, paths) {
      if (paths.length === 0) {
        return
      }
      await call(`/object/${bucket}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      })
    },
    async signedUrl(bucket, path, expiresInSeconds) {
      try {
        const response = await call(
          `/object/sign/${bucket}/${encodePath(path)}`,
          json({ expiresIn: expiresInSeconds }),
        )
        const { signedURL } = (await response.json()) as { signedURL: string }
        return `${base}${signedURL}`
      } catch {
        return null
      }
    },
    async signedUrls(bucket, paths, expiresInSeconds) {
      const urls = new Map<string, string>()
      if (paths.length === 0) {
        return urls
      }
      try {
        const response = await call(
          `/object/sign/${bucket}`,
          json({ expiresIn: expiresInSeconds, paths }),
        )
        const items = (await response.json()) as {
          path: string | null
          signedURL: string | null
          error: string | null
        }[]
        for (const item of items) {
          if (item.path && item.signedURL && !item.error) {
            urls.set(item.path, `${base}${item.signedURL}`)
          }
        }
      } catch (error) {
        // Без ссылок карточки показывают букву ника; список не падает.
        console.error('Не удалось подписать ссылки Storage', error)
      }
      return urls
    },
  }
}
