import {
  ACCESS_ROLES,
  ROLE_LABELS,
  useAccess,
  type AccessRole,
} from '@/app/access'

/** Только для разработки: просмотр меню и доступа от имени любой роли. */
export default function DevRoleSwitcher() {
  const { role, setRole } = useAccess()
  if (!setRole) return null
  return (
    <div className="dev-role-switcher">
      <label htmlFor="dev-role-switcher">Смотреть как…</label>
      <select
        id="dev-role-switcher"
        value={role}
        onChange={(event) => setRole(event.target.value as AccessRole)}
      >
        {ACCESS_ROLES.map((value) => (
          <option key={value} value={value}>
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
    </div>
  )
}
