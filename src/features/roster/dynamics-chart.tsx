import { useState } from 'react'
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

const plot = { left: 18, right: 98, top: 10, bottom: 72 }

function numberLabel(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}

type HoveredStatPoint = {
  id: string
  field: CharacterStatNumberField
  recordedAt: string
  value: number | null
  previousValue: number | null
}

export function StatChart({
  fields,
  points,
}: {
  fields: CharacterStatNumberField[]
  points: DynamicsStatPoint[]
}) {
  const [hovered, setHovered] = useState<HoveredStatPoint | null>(null)
  const series = fields.map((field) => ({
    field,
    points: points
      .filter((point) => point.field === field)
      .sort(
        (a, b) =>
          a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
      ),
  }))
  const history = series.flatMap((item) => item.points)
  const numericPoints = history.filter(
    (point): point is DynamicsStatPoint & { value: number } =>
      point.value !== null,
  )
  const timestamps = history.map((point) => Date.parse(point.recordedAt))
  const minTime = Math.min(...timestamps)
  const maxTime = Math.max(...timestamps)
  const timeRange = maxTime - minTime || 1
  const values = numericPoints.map((point) => point.value)
  const rawMin = Math.min(...values, 0)
  const rawMax = Math.max(...values, 1)
  const valuePadding =
    rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * 0.05) : 0
  const minValue = rawMin - valuePadding
  const maxValue = rawMax + valuePadding
  const valueRange = maxValue - minValue || 1
  const x = (point: DynamicsStatPoint) =>
    plot.left +
    ((Date.parse(point.recordedAt) - minTime) / timeRange) *
      (plot.right - plot.left)
  const y = (value: number) =>
    plot.bottom - ((value - minValue) / valueRange) * (plot.bottom - plot.top)

  function hoverPoint(
    field: CharacterStatNumberField,
    point: DynamicsStatPoint,
  ) {
    const fieldPoints =
      series.find((item) => item.field === field)?.points ?? []
    const index = fieldPoints.findIndex((item) => item.id === point.id)
    const previousValue =
      fieldPoints
        .slice(0, index)
        .reverse()
        .find((item) => item.value !== null)?.value ?? null
    setHovered({
      id: point.id,
      field,
      recordedAt: point.recordedAt,
      value: point.value,
      previousValue,
    })
  }

  function pointSummary(point: HoveredStatPoint) {
    if (point.value === null) {
      return `${CHARACTER_STAT_LABELS[point.field]} · ${formatDate(point.recordedAt)} · значение очищено`
    }
    if (point.previousValue === null) {
      return `${CHARACTER_STAT_LABELS[point.field]} · ${formatDate(point.recordedAt)} · исходное значение ${numberLabel(point.value)}`
    }
    const delta = point.value - point.previousValue
    const change =
      delta > 0 ? 'улучшение' : delta < 0 ? 'ухудшение' : 'без изменений'
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
    return `${CHARACTER_STAT_LABELS[point.field]} · ${formatDate(point.recordedAt)} · ${numberLabel(point.value)} · ${change} ${sign}${numberLabel(Math.abs(delta))}`
  }

  const tickTimes =
    minTime === maxTime
      ? [{ at: 0.5, value: minTime }]
      : [
          { at: 0, value: minTime },
          { at: 0.5, value: minTime + timeRange / 2 },
          { at: 1, value: maxTime },
        ]

  const activePoint = hovered
    ? series
        .find((item) => item.field === hovered.field)
        ?.points.find((point) => point.id === hovered.id)
    : undefined
  const activeX = activePoint ? x(activePoint) : plot.left
  const activeY =
    activePoint && activePoint.value !== null
      ? y(activePoint.value)
      : plot.bottom + 2

  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl border border-border-accent/70 bg-background/45 p-3"
      aria-label="График характеристик"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg">Изменение характеристик</h3>
        <span className="text-xs text-muted-foreground">
          {numericPoints.length} точек
        </span>
      </div>
      {history.length ? (
        <svg
          viewBox="0 0 108 100"
          aria-label="Ось X — дата, ось Y — значение показателя"
          className="h-72 w-full overflow-visible sm:h-80"
        >
          {[0, 0.5, 1].map((fraction) => {
            const gridY = plot.bottom - fraction * (plot.bottom - plot.top)
            const tickValue = minValue + fraction * valueRange
            return (
              <g key={fraction}>
                <path
                  d={`M${plot.left} ${gridY}H${plot.right}`}
                  stroke="currentColor"
                  opacity=".16"
                  strokeWidth=".35"
                />
                <text
                  x={plot.left - 2}
                  y={gridY + 1.2}
                  textAnchor="end"
                  fill="var(--muted-foreground)"
                  fontSize="2.7"
                >
                  {numberLabel(tickValue)}
                </text>
              </g>
            )
          })}
          <path
            d={`M${plot.left} ${plot.top}V${plot.bottom}H${plot.right}`}
            fill="none"
            stroke="currentColor"
            opacity=".45"
            strokeWidth=".45"
          />
          {series.map(({ field, points: fieldPoints }) => {
            const segments: DynamicsStatPoint[][] = []
            let segment: DynamicsStatPoint[] = []
            for (const point of fieldPoints) {
              if (point.value === null) {
                if (segment.length) segments.push(segment)
                segment = []
              } else {
                segment.push(point)
              }
            }
            if (segment.length) segments.push(segment)
            return (
              <g key={field}>
                {segments.map((items) => {
                  const linePoints = items
                    .map((point) => `${x(point)},${y(point.value!)}`)
                    .join(' ')
                  const first = items[0]!
                  const last = items.at(-1)!
                  const areaPoints = `${x(first)},${plot.bottom} ${linePoints} ${x(last)},${plot.bottom}`
                  return (
                    <g key={first.id}>
                      {items.length > 1 && (
                        <polygon
                          points={areaPoints}
                          fill={colors[field]}
                          fillOpacity=".16"
                        />
                      )}
                      {items.length > 1 && (
                        <polyline
                          fill="none"
                          stroke={colors[field]}
                          strokeWidth="1.2"
                          points={linePoints}
                        />
                      )}
                    </g>
                  )
                })}
                {fieldPoints.map((point) => {
                  const cx = x(point)
                  const cy =
                    point.value === null ? plot.bottom + 2 : y(point.value)
                  return (
                    <circle
                      key={point.id}
                      cx={cx}
                      cy={cy}
                      r="1.35"
                      fill={
                        point.value === null
                          ? 'var(--background)'
                          : colors[field]
                      }
                      stroke={colors[field]}
                      strokeWidth=".65"
                      onMouseEnter={() => hoverPoint(field, point)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <title>
                        {pointSummary({
                          id: point.id,
                          field,
                          recordedAt: point.recordedAt,
                          value: point.value,
                          previousValue:
                            fieldPoints
                              .slice(
                                0,
                                fieldPoints.findIndex(
                                  (item) => item.id === point.id,
                                ),
                              )
                              .reverse()
                              .find((item) => item.value !== null)?.value ??
                            null,
                        })}
                      </title>
                    </circle>
                  )
                })}
              </g>
            )
          })}
          {tickTimes.map((tick) => {
            const tickX = plot.left + tick.at * (plot.right - plot.left)
            return (
              <text
                key={tick.at}
                x={tickX}
                y="81"
                textAnchor={
                  tick.at === 0 ? 'start' : tick.at === 1 ? 'end' : 'middle'
                }
                fill="var(--muted-foreground)"
                fontSize="2.8"
              >
                {formatDate(new Date(tick.value).toISOString())}
              </text>
            )
          })}
          {hovered && activePoint && (
            <g pointerEvents="none">
              <rect
                x={Math.min(Math.max(plot.left, activeX + 2), plot.right - 52)}
                y={Math.max(plot.top, activeY - 10)}
                width="52"
                height="8"
                rx="1"
                fill="var(--surface-menu)"
                stroke="var(--border-accent)"
                strokeWidth=".35"
              />
              <text
                x={
                  Math.min(Math.max(plot.left, activeX + 2), plot.right - 52) +
                  2
                }
                y={Math.max(plot.top, activeY - 5)}
                fill="var(--foreground)"
                fontSize="2.4"
              >
                {pointSummary(hovered)}
              </text>
            </g>
          )}
          <text
            x="58"
            y="91"
            textAnchor="middle"
            fill="var(--muted-foreground)"
            fontSize="3"
          >
            Дата
          </text>
          <text x="3" y="8" fill="var(--muted-foreground)" fontSize="3">
            Значение
          </text>
        </svg>
      ) : (
        <p className="m-0 py-8 text-center text-sm text-muted-foreground">
          За этот период нет записей.
        </p>
      )}
      <p
        className="m-0 flex h-10 items-center truncate text-sm text-foreground"
        role="status"
        title={hovered ? pointSummary(hovered) : undefined}
      >
        {hovered && history.some((point) => point.id === hovered.id)
          ? pointSummary(hovered)
          : 'Наведите на точку, чтобы увидеть изменение.'}
      </p>
    </section>
  )
}

export function AttendanceChart({
  points,
}: {
  points: DynamicsAttendancePoint[]
}) {
  const [hoveredWeek, setHoveredWeek] =
    useState<DynamicsAttendancePoint | null>(null)
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
                <g
                  key={point.weekStart}
                  aria-label={label}
                  onMouseEnter={() => setHoveredWeek(point)}
                  onMouseLeave={() => setHoveredWeek(null)}
                >
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
            {hoveredWeek &&
              (() => {
                const index = points.findIndex(
                  (point) => point.weekStart === hoveredWeek.weekStart,
                )
                if (index < 0) return null
                const x = index * 14 + 4
                const total =
                  hoveredWeek.visited +
                  hoveredWeek.missed +
                  hoveredWeek.unmarked
                const height = Math.max(3, (total / max) * 112)
                const left = Math.min(
                  Math.max(0, x - 22),
                  Math.max(0, points.length * 14 - 58),
                )
                return (
                  <g pointerEvents="none">
                    <rect
                      x={left}
                      y={Math.max(2, 118 - height - 12)}
                      width="58"
                      height="10"
                      rx="1"
                      fill="var(--surface-menu)"
                      stroke="var(--border-accent)"
                      strokeWidth=".35"
                    />
                    <text
                      x={left + 2}
                      y={Math.max(2, 118 - height - 6)}
                      fill="var(--foreground)"
                      fontSize="2.5"
                    >
                      {`${formatDate(hoveredWeek.weekStart)} · ${hoveredWeek.visited}/${hoveredWeek.missed}/${hoveredWeek.unmarked}`}
                    </text>
                  </g>
                )
              })()}
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
      <p
        className="m-0 flex h-10 items-center truncate text-sm text-foreground"
        role="status"
        title={
          hoveredWeek
            ? `Неделя с ${formatDate(hoveredWeek.weekStart)}: посетил — ${hoveredWeek.visited}, не посетил — ${hoveredWeek.missed}, без отметки — ${hoveredWeek.unmarked}`
            : undefined
        }
      >
        {hoveredWeek
          ? `Неделя с ${formatDate(hoveredWeek.weekStart)}: посетил — ${hoveredWeek.visited}, не посетил — ${hoveredWeek.missed}, без отметки — ${hoveredWeek.unmarked}`
          : 'Наведите на столбец, чтобы увидеть числа за неделю.'}
      </p>
    </section>
  )
}
