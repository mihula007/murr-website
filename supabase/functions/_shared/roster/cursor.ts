import { z } from 'zod'
import type { NicknameKey } from './repository.ts'

/** Курсор списков по нику (состав, чтецы, аккаунты): `[ник, id]`. */
export const nicknameCursor = z
  .tuple([z.string().min(1).max(64), z.guid()])
  .transform(([gameNickname, id]): NicknameKey => ({ gameNickname, id }))

export function nicknameKey(gameNickname: string, id: string) {
  return [gameNickname, id] as const
}
