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
import {
  AttendanceChart,
  StatChart,
  type AttendanceStatus,
} from './dynamics-chart'
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
const ATTENDANCE_STATUSES: {
  value: AttendanceStatus
  label: string
  marker: string
}[] = [
  { value: 'visited', label: 'Посетил', marker: 'bg-highlight' },
  { value: 'missed', label: 'Не посетил', marker: 'bg-destructive' },
  { value: 'unmarked', label: 'Не отметил', marker: 'bg-muted-foreground' },
]

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
  const [attendanceStatuses, setAttendanceStatuses] = useState<
    AttendanceStatus[]
  >(['visited', 'missed', 'unmarked'])
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
        className="w-[min(calc(100vw-24px),1180px)] max-w-[1180px] gap-4 p-4 sm:p-6"
      >
        <DialogHeader className="grid gap-3 pr-10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="grid gap-2">
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
          </div>
          <div className="grid justify-items-start gap-2 sm:justify-items-end">
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Раздел динамики"
            >
              <Button
                type="button"
                size="sm"
                variant={tab === 'stats' ? 'default' : 'secondary'}
                onClick={() => setTab('stats')}
              >
                Характеристики
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === 'attendance' ? 'default' : 'secondary'}
                onClick={() => setTab('attendance')}
              >
                Посещение ивентов
              </Button>
            </div>
            {tab === 'stats' && (
              <fieldset
                className="flex flex-wrap gap-x-2.5 gap-y-1 border-0 p-0"
                aria-label="Показатели"
              >
                {CHARACTER_STAT_FIELDS.map((field) => (
                  <label
                    key={field}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs"
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
            )}
            {tab === 'attendance' && (
              <fieldset
                className="flex flex-wrap gap-x-2.5 gap-y-1 border-0 p-0"
                aria-label="Статусы посещения"
              >
                {ATTENDANCE_STATUSES.map((status) => (
                  <label
                    key={status.value}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 rounded-full ${status.marker}`}
                    />
                    <input
                      type="checkbox"
                      checked={attendanceStatuses.includes(status.value)}
                      onChange={(event) =>
                        setAttendanceStatuses((current) => {
                          if (event.target.checked) {
                            return [...current, status.value]
                          }
                          return current.filter((item) => item !== status.value)
                        })
                      }
                    />
                    {status.label}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Период</span>
              <Select
                aria-label="Период истории"
                value={period}
                onValueChange={(value) => setPeriod(value as DynamicsPeriod)}
                options={PERIODS}
              />
            </div>
          </div>
        </DialogHeader>
        <div className="grid gap-4">
          {tab === 'stats' ? (
            <>
              {stats.isError ? (
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
                <StatChart
                  fields={fields}
                  points={points}
                  loading={stats.isPending && fields.length > 0}
                />
              )}
            </>
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
            <AttendanceChart
              points={weeks}
              loading={attendance.isPending}
              statuses={attendanceStatuses}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
