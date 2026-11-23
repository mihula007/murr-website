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

const plot = { left: 18, right: 982, top: 12, bottom: 288 }

function numberLabel(value: number) {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}

type NumericStatPoint = DynamicsStatPoint & { value: number }

function smoothPath(
  points: NumericStatPoint[],
  x: (point: DynamicsStatPoint) => number,
  y: (value: number) => number,
) {
  const coordinates = points.map((point) => ({
    x: x(point),
    y: y(point.value),
  }))
  if (!coordinates.length) return ''
  let path = `M${coordinates[0]!.x} ${coordinates[0]!.y}`
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] ?? coordinates[index]!
    const start = coordinates[index]!
    const end = coordinates[index + 1]!
    const next = coordinates[index + 2] ?? end
    const controlOneX = start.x + (end.x - previous.x) / 6
    const controlOneY = start.y + (end.y - previous.y) / 6
    const controlTwoX = end.x - (next.x - start.x) / 6
    const controlTwoY = end.y - (next.y - start.y) / 6
    path += ` C${controlOneX} ${controlOneY},${controlTwoX} ${controlTwoY},${end.x} ${end.y}`
  }
  return path
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
  loading,
}: {
  fields: CharacterStatNumberField[]
  points: DynamicsStatPoint[]
  loading: boolean
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
  const minTime = timestamps.length ? Math.min(...timestamps) : 0
  const maxTime = timestamps.length ? Math.max(...timestamps) : 1
  const timeRange = maxTime - minTime || 1
  const values = numericPoints.map((point) => point.value)
  const minValue = Math.min(...values, 0)
  const maxValue = Math.max(...values, 1)
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

  const tickTimes = history.length
    ? minTime === maxTime
      ? [{ at: 0.5, value: minTime }]
      : [
          { at: 0, value: minTime },
          { at: 0.5, value: minTime + timeRange / 2 },
          { at: 1, value: maxTime },
        ]
    : []
  const hoveredPoint =
    hovered && history.some((point) => point.id === hovered.id) ? hovered : null
  const statusText = hoveredPoint
    ? pointSummary(hoveredPoint)
    : loading
      ? 'Загружаем историю…'
      : !fields.length
        ? 'Выберите показатель, чтобы показать линию.'
        : !history.length
          ? 'За этот период нет записей.'
          : 'Наведите на точку, чтобы увидеть изменение.'

  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl border border-border-accent/70 bg-background/45 p-3"
      aria-label="График характеристик"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg">Изменение характеристик</h3>
        <span className="text-sm text-muted-foreground">
          {numericPoints.length} точек
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <div className="self-end pb-1 text-right text-xs font-medium text-muted-foreground sm:text-sm">
          Значение
        </div>
        <div />
        <div className="flex flex-col justify-between py-1 text-right text-xs tabular-nums text-muted-foreground sm:text-sm">
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction} className="whitespace-nowrap">
              {numberLabel(minValue + fraction * valueRange)}
            </span>
          ))}
        </div>
        <svg
          viewBox="0 0 1000 300"
          preserveAspectRatio="none"
          aria-label="Ось X — дата, ось Y — значение показателя"
          className="h-[250px] w-full overflow-visible sm:h-[390px]"
        >
          <defs>
            {fields.map((field) => (
              <linearGradient
                key={field}
                id={`dynamics-area-${field}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={colors[field]} stopOpacity=".42" />
                <stop
                  offset="100%"
                  stopColor={colors[field]}
                  stopOpacity=".025"
                />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.5, 1].map((fraction) => {
            const gridY = plot.bottom - fraction * (plot.bottom - plot.top)
            return (
              <path
                key={fraction}
                d={`M${plot.left} ${gridY}H${plot.right}`}
                stroke="currentColor"
                opacity=".2"
                strokeWidth="1"
              />
            )
          })}
          <path
            d={`M${plot.left} ${plot.top}V${plot.bottom}H${plot.right}`}
            fill="none"
            stroke="currentColor"
            opacity=".45"
            strokeWidth="1.25"
          />
          {series.map(({ field, points: fieldPoints }) => {
            const segments: NumericStatPoint[][] = []
            let segment: NumericStatPoint[] = []
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
                  const linePath = smoothPath(items, x, y)
                  const first = items[0]!
                  const last = items.at(-1)!
                  const areaPath = `${linePath} L${x(last)} ${plot.bottom} L${x(first)} ${plot.bottom} Z`
                  return (
                    <g key={first.id}>
                      {items.length > 1 && (
                        <path
                          d={areaPath}
                          fill={`url(#dynamics-area-${field})`}
                        />
                      )}
                      {items.length > 1 && (
                        <path
                          fill="none"
                          stroke={colors[field]}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={linePath}
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
                      r="7"
                      fill={
                        point.value === null
                          ? 'var(--background)'
                          : colors[field]
                      }
                      stroke={colors[field]}
                      strokeWidth="2"
                      aria-label={pointSummary({
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
                            .find((item) => item.value !== null)?.value ?? null,
                      })}
                      onMouseEnter={() => hoverPoint(field, point)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>
        <div className="relative col-start-2 h-6 text-xs tabular-nums text-muted-foreground sm:text-sm">
          {tickTimes.map((tick) => (
            <span
              key={tick.at}
              className={`absolute whitespace-nowrap ${tick.at === 0 ? 'left-0' : tick.at === 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
            >
              {formatDate(new Date(tick.value).toISOString())}
            </span>
          ))}
        </div>
        <div className="col-span-2 text-center text-xs font-medium text-muted-foreground sm:text-sm">
          Дата
        </div>
      </div>
      <p
        className="m-0 flex h-10 items-center truncate text-sm text-foreground"
        role="status"
        title={hovered ? pointSummary(hovered) : undefined}
      >
        {statusText}
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
            width={Math.max(320, points.length * 24)}
            height="230"
            viewBox={`0 0 ${Math.max(320, points.length * 24)} 230`}
            aria-label={`${points.length} недель`}
          >
            {points.map((point, index) => {
              const total = point.visited + point.missed + point.unmarked
              const height = Math.max(3, (total / max) * 146)
              const x = index * 24 + 5
              const top = 175 - height
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
                  <path
                    d={`M${x - 2} 175h18`}
                    stroke="currentColor"
                    opacity=".35"
                  />
                  {point.visited > 0 && (
                    <rect
                      x={x}
                      y={175 - visitedHeight}
                      width="14"
                      height={visitedHeight}
                      fill="var(--highlight)"
                    />
                  )}
                  {point.missed > 0 && (
                    <rect
                      x={x}
                      y={175 - visitedHeight - missedHeight}
                      width="14"
                      height={missedHeight}
                      fill="var(--destructive)"
                    />
                  )}
                  {point.unmarked > 0 && (
                    <rect
                      x={x}
                      y={top}
                      width="14"
                      height={unmarkedHeight}
                      fill="var(--muted-foreground)"
                    />
                  )}
                  <text
                    x={x + 7}
                    y="218"
                    fill="var(--muted-foreground)"
                    fontSize="12"
                    textAnchor="end"
                    transform={`rotate(-50 ${x + 7} 218)`}
                  >
                    {formatDate(point.weekStart)}
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
