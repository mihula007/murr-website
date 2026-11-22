import type { CharacterStatNumberField } from '@contracts/character-stats'
import type {
  DynamicsAttendancePoint,
  DynamicsStatPoint,
} from '@contracts/roster-dynamics'
import { CHARACTER_STAT_LABELS } from '@contracts/character-stats'
import { formatDate } from '@/lib/format-date'

const colors: Record<CharacterStatNumberField, string> = {
  pa: 'var(--highlight)',
  pz: 'var(--medal-silver-from)',
  bu: 'var(--medal-bronze-from)',
  hp: 'var(--live)',
  bd: 'var(--destructive)',
}

export function StatChart({
  field,
  points,
}: {
  field: CharacterStatNumberField
  points: DynamicsStatPoint[]
}) {
  const history = points.filter((point) => point.field === field)
  const values = history.filter((point) => point.value !== null)
  const cleared = history.filter((point) => point.value === null)
  const min = Math.min(...values.map((point) => point.value!), 0)
  const max = Math.max(...values.map((point) => point.value!), 1)
  const range = max - min || 1
  const coords = values.map((point) => ({
    point,
    x:
      history.length < 2
        ? 50
        : 8 +
          (history.findIndex((item) => item.id === point.id) * 84) /
            (history.length - 1),
    y: 88 - ((point.value! - min) / range) * 76,
  }))
  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl border border-border-accent/70 bg-background/45 p-3"
      aria-label={`График ${CHARACTER_STAT_LABELS[field]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg">{CHARACTER_STAT_LABELS[field]}</h3>
        <span className="text-xs text-muted-foreground">
          {values.length} точек
        </span>
      </div>
      {history.length ? (
        <svg
          viewBox="0 0 100 100"
          aria-label={`${CHARACTER_STAT_LABELS[field]}: от ${min} до ${max}`}
          className="h-36 w-full overflow-visible"
        >
          <path
            d="M8 88H92 M8 12V88"
            stroke="currentColor"
            opacity=".2"
            strokeWidth=".5"
          />
          {values.length === 0 && (
            <text
              x="50"
              y="55"
              textAnchor="middle"
              fill="currentColor"
              fontSize="5"
            >
              В выбранном периоде нет числового значения
            </text>
          )}
          {coords.length > 1 && (
            <polyline
              fill="none"
              stroke={colors[field]}
              strokeWidth="1.8"
              points={coords.map(({ x, y }) => `${x},${y}`).join(' ')}
            />
          )}
          {coords.map(({ point, x, y }) => (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r="2.2"
              fill={colors[field]}
              stroke="var(--color-background)"
              strokeWidth=".8"
            >
              <title>{`${formatDate(point.recordedAt)}: ${point.value}`}</title>
            </circle>
          ))}
          {cleared.map((point) => {
            const index = history.findIndex((item) => item.id === point.id)
            const x =
              history.length < 2 ? 50 : 8 + (index * 84) / (history.length - 1)
            return (
              <circle
                key={point.id}
                cx={x}
                cy="94"
                r="2.5"
                fill="var(--background)"
                stroke={colors[field]}
                strokeWidth="1.2"
              >
                <title>{`${formatDate(point.recordedAt)}: значение очищено`}</title>
              </circle>
            )
          })}
        </svg>
      ) : (
        <p className="m-0 py-8 text-center text-sm text-muted-foreground">
          За этот период нет записей.
        </p>
      )}
      {history.length > 0 && (
        <div className="flex justify-between text-2xs text-muted-foreground">
          <span>{formatDate(history[0]?.recordedAt)}</span>
          <span>{formatDate(history.at(-1)?.recordedAt)}</span>
        </div>
      )}
      {cleared.length > 0 && (
        <p className="m-0 text-xs text-muted-foreground">
          Очищено:{' '}
          {cleared.map((point) => formatDate(point.recordedAt)).join(', ')}
        </p>
      )}
    </section>
  )
}

export function AttendanceChart({
  points,
}: {
  points: DynamicsAttendancePoint[]
}) {
  const max = Math.max(
    1,
    ...points.map((point) => point.visited + point.missed + point.unmarked),
  )
  return (
    <section
      className="grid min-w-0 gap-3 rounded-xl border border-border-accent/70 bg-background/45 p-3"
      aria-label="Посещение ивентов по неделям"
    >
      <h3 className="m-0 text-lg">Посещение ивентов по неделям</h3>
      {points.length ? (
        <div className="overflow-x-auto pb-2">
          <svg
            width={Math.max(160, points.length * 14)}
            height="150"
            viewBox={`0 0 ${Math.max(160, points.length * 14)} 150`}
            aria-label={`${points.length} недель`}
          >
            {points.map((point, index) => {
              const total = point.visited + point.missed + point.unmarked
              const height = Math.max(3, (total / max) * 112)
              const x = index * 14 + 4
              const top = 118 - height
              const visitedHeight = total ? (height * point.visited) / total : 0
              const missedHeight = total ? (height * point.missed) / total : 0
              const unmarkedHeight = total
                ? (height * point.unmarked) / total
                : 0
              const label = `${formatDate(point.weekStart)}: посещено ${point.visited}, пропущено ${point.missed}, без отметки ${point.unmarked}`
              return (
                <g key={point.weekStart} aria-label={label}>
                  <title>{label}</title>
                  {point.visited > 0 && (
                    <rect
                      x={x}
                      y={118 - visitedHeight}
                      width="9"
                      height={visitedHeight}
                      fill="var(--highlight)"
                    />
                  )}
                  {point.missed > 0 && (
                    <rect
                      x={x}
                      y={118 - visitedHeight - missedHeight}
                      width="9"
                      height={missedHeight}
                      fill="var(--destructive)"
                    />
                  )}
                  {point.unmarked > 0 && (
                    <rect
                      x={x}
                      y={top}
                      width="9"
                      height={unmarkedHeight}
                      fill="var(--muted-foreground)"
                    />
                  )}
                  <text
                    x={x + 4}
                    y="139"
                    fill="var(--muted-foreground)"
                    fontSize="5"
                    textAnchor="end"
                    transform={`rotate(-50 ${x + 4} 139)`}
                  >
                    {point.weekStart.slice(5)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      ) : (
        <p className="m-0 py-8 text-center text-sm text-muted-foreground">
          За выбранный период закрытых ивентов нет.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Посетил</span>
        <span>Не посетил</span>
        <span>Без отметки</span>
      </div>
    </section>
  )
}
