import { z } from 'zod'

/** Ограничения полей (ACC, Q-11, Q-27). Общие для клиента и сервера. */
export const LIMITS = {
  displayName: 12,
  gameNickname: 9,
  city: 100,
  about: 1200,
  equipmentLinks: 10,
  equipmentLink: 500,
  avatarBytes: 500 * 1024,
  avatarSide: 512,
  passwordMin: 8,
} as const

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AvatarType = (typeof AVATAR_TYPES)[number]

// Сообщения схем — коды ошибок полей; тексты подставляет клиент.
const required = (max: number) =>
  z.string().trim().min(1, 'required').max(max, 'too_long')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'too_long')
    .nullable()
    .transform((value) => value || null)

export const displayNameSchema = required(LIMITS.displayName)
export const gameNicknameSchema = required(LIMITS.gameNickname)

export const birthDateSchema = z.iso
  .date('invalid_date')
  .refine(
    (value) =>
      value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10),
    'invalid_date',
  )

export const classIdSchema = z.number('required').int().positive('required')

export const equipmentLinkSchema = z
  .string()
  .trim()
  .max(LIMITS.equipmentLink, 'too_long')
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'invalid_url')

export const registrationFieldsSchema = z.object({
  displayName: displayNameSchema,
  gameNickname: gameNicknameSchema,
  city: required(LIMITS.city),
  birthDate: birthDateSchema,
  classId: classIdSchema,
  about: required(LIMITS.about),
  // Пустые строки формы не считаются ссылками.
  equipmentLinks: z
    .array(z.string())
    .transform((links) => links.filter((link) => link.trim() !== ''))
    .pipe(z.array(equipmentLinkSchema).max(LIMITS.equipmentLinks, 'too_many')),
})
export type RegistrationFields = z.infer<typeof registrationFieldsSchema>

export const completeRegistrationSchema = registrationFieldsSchema.extend({
  avatarPath: z.string().min(1, 'required').max(200, 'too_long'),
})
export type CompleteRegistrationRequest = z.input<
  typeof completeRegistrationSchema
>

export const avatarChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }),
  z.object({ action: z.literal('remove') }),
  z.object({
    action: z.literal('replace'),
    path: z.string().min(1, 'required').max(200, 'too_long'),
  }),
])

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  gameNickname: gameNicknameSchema,
  city: optionalText(LIMITS.city),
  birthDate: birthDateSchema.nullable(),
  classId: classIdSchema,
  about: optionalText(LIMITS.about),
  avatar: avatarChangeSchema,
})
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>

export const checkNicknameSchema = z.object({
  gameNickname: gameNicknameSchema,
})
export type CheckNicknameResponse = { available: boolean }

export const avatarUploadSchema = z.object({
  contentType: z.enum(AVATAR_TYPES, 'avatar_invalid'),
})
export type AvatarUploadResponse = {
  bucket: 'avatars'
  path: string
  token: string
}

export type AccessRole = 'applicant' | 'reader' | 'member' | 'officer' | 'admin'

export type ApplicationStatus =
  | 'pending_officer_review'
  | 'pending_vote'
  | 'vote_completed'
  | 'officer_approved'
  | 'officer_rejected'
  | 'admin_approved'
  | 'admin_rejected'

export type ProfileView = {
  id: string
  displayName: string
  gameNickname: string
  city: string | null
  birthDate: string | null
  classId: number
  className: string
  about: string | null
  avatarUrl: string | null
  role: AccessRole
  joinedOn: string | null
  createdAt: string
}

export type ApplicationView = {
  id: string
  status: ApplicationStatus
  submittedAt: string
}

export type MeResponse =
  | { state: 'incomplete'; email: string }
  | {
      state: 'ready'
      email: string
      profile: ProfileView
      /** Чтецу не показывается (ACC-05). */
      application: ApplicationView | null
    }
