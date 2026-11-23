import { useEffect, useState } from 'react'
import type { CharacterStatNumberField } from '@contracts/character-stats'
import type { RosterMember } from '@contracts/roster'
import {
  CHARACTER_STAT_FIELDS,
  CHARACTER_STAT_LABELS,
} from '@contracts/character-stats'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { formatDate } from '@/lib/format-date'
import { AttendanceChart, StatChart } from './dynamics-chart'
import {
  useDynamicsAttendance,
  useDynamicsProfile,
  useDynamicsStats,
  type DynamicsPeriod,
} from './dynamics-api'

const PERIODS: { value: DynamicsPeriod; label: string }[] = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: '365 дней' },
  { value: 'all', label: 'Всё время' },
]
const FIELD_MARKER_CLASSES: Record<CharacterStatNumberField, string> = {
  pa: 'bg-highlight',
  pz: 'bg-foreground',
  bu: 'bg-primary',
  hp: 'bg-live',
  bd: 'bg-destructive',
}

export function MemberDynamicsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: RosterMember | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [period, setPeriod] = useState<DynamicsPeriod>('all')
  const [fields, setFields] = useState<CharacterStatNumberField[]>(['pa'])
  const [tab, setTab] = useState<'stats' | 'attendance'>('stats')
  const userId = member?.id ?? ''
  const profile = useDynamicsProfile(userId, open && Boolean(member))
  const stats = useDynamicsStats(
    userId,
    period,
    fields,
    open && Boolean(member) && tab === 'stats' && fields.length > 0,
  )
  const attendance = useDynamicsAttendance(
    userId,
    period,
    open && Boolean(member) && tab === 'attendance',
  )
  const fetchNextStats = stats.fetchNextPage
  const fetchNextAttendance = attendance.fetchNextPage
  const statsHasNextPage = stats.hasNextPage
  const statsIsFetching = stats.isFetching
  const attendanceHasNextPage = attendance.hasNextPage
  const attendanceIsFetching = attendance.isFetching

  useEffect(() => {
    if (open && tab === 'stats' && statsHasNextPage && !statsIsFetching) {
      void fetchNextStats()
    }
  }, [open, tab, statsHasNextPage, statsIsFetching, fetchNextStats])
  useEffect(() => {
    if (
      open &&
      tab === 'attendance' &&
      attendanceHasNextPage &&
      !attendanceIsFetching
    ) {
      void fetchNextAttendance()
    }
  }, [
    open,
    tab,
    attendanceHasNextPage,
    attendanceIsFetching,
    fetchNextAttendance,
  ])

  const points =
    stats.data?.pages
      .flatMap((page) => page.items)
      .sort(
        (a, b) =>
          a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
      ) ?? []
  const weeks =
    attendance.data?.pages
      .flatMap((page) => page.items)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart)) ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="member-dynamics-description"
        className="w-[min(calc(100vw-24px),900px)] max-w-[900px] gap-5 p-5 sm:p-7"
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar
              size="sm"
              name={profile.data?.gameNickname ?? member?.gameNickname ?? ''}
              src={profile.data?.avatarUrl ?? member?.avatarUrl ?? null}
              alt=""
            />
            <div className="min-w-0">
              <DialogTitle>Динамика развития</DialogTitle>
              <DialogDescription id="member-dynamics-description">
                {profile.data?.gameNickname ?? member?.gameNickname} ·{' '}
                {profile.data?.className ?? member?.className}
              </DialogDescription>
            </div>
          </div>
          {profile.data && (
            <p className="m-0 text-sm text-muted-foreground">
              {profile.data.displayName ? (
                <>
                  <span className="text-foreground">
                    {profile.data.displayName}
                  </span>
                  <span className="mx-2">·</span>
                </>
              ) : null}
              В клане с {formatDate(profile.data.joinedOn)}
            </p>
          )}
          {profile.isError && (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="alert"
            >
              <span>Не удалось загрузить имя и дату вступления.</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void profile.refetch()}
              >
                Повторить
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex gap-2"
              role="tablist"
              aria-label="Раздел динамики"
            >
              <Button
                type="button"
                variant={tab === 'stats' ? 'default' : 'secondary'}
                onClick={() => setTab('stats')}
              >
                Характеристики
              </Button>
              <Button
                type="button"
                variant={tab === 'attendance' ? 'default' : 'secondary'}
                onClick={() => setTab('attendance')}
              >
                Посещение ивентов
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Период{' '}
              <Select
                aria-label="Период истории"
                value={period}
                onValueChange={(value) => setPeriod(value as DynamicsPeriod)}
                options={PERIODS}
              />
            </label>
          </div>
          {tab === 'stats' ? (
            <>
              <fieldset
                className="flex flex-wrap gap-x-4 gap-y-2 border-0 p-0"
                aria-label="Показатели"
              >
                {CHARACTER_STAT_FIELDS.map((field) => (
                  <label
                    key={field}
                    className="inline-flex items-center gap-2 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 rounded-full ${FIELD_MARKER_CLASSES[field]}`}
                    />
                    <input
                      type="checkbox"
                      checked={fields.includes(field)}
                      onChange={(event) =>
                        setFields((current) => {
                          if (event.target.checked) {
                            return [...current, field]
                          }
                          return current.filter((item) => item !== field)
                        })
                      }
                    />
                    {CHARACTER_STAT_LABELS[field]}
                  </label>
                ))}
              </fieldset>
              {fields.length === 0 ? (
                <p className="m-0 py-8 text-center text-sm text-muted-foreground">
                  Выберите показатель, чтобы показать линию.
                </p>
              ) : stats.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Загружаем историю…
                </p>
              ) : stats.isError ? (
                <div className="grid gap-2 text-sm">
                  <p>Не удалось загрузить историю характеристик.</p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void stats.refetch()}
                  >
                    Повторить
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  <StatChart fields={fields} points={points} />
                </div>
              )}
            </>
          ) : attendance.isPending ? (
            <p className="text-sm text-muted-foreground">
              Загружаем посещения…
            </p>
          ) : attendance.isError ? (
            <div className="grid gap-2 text-sm">
              <p>Не удалось загрузить посещения.</p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void attendance.refetch()}
              >
                Повторить
              </Button>
            </div>
          ) : (
            <AttendanceChart points={weeks} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
