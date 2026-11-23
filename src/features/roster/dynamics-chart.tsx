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
export type AttendanceStatus = 'visited' | 'missed' | 'unmarked'

function smoothPath<T extends { value: number }>(
  points: T[],
  x: (point: T) => number,
  y: (value: number) => number,
) {
  const coordinates = points.map((point) => ({
    x: x(point),
    y: y(point.value),
  }))
  if (!coordinates.length) {
    return ''
  }
  if (coordinates.length === 1) {
    return `M${coordinates[0]!.x} ${coordinates[0]!.y}`
  }
  const widths = coordinates.slice(0, -1).map((point, index) => {
    return coordinates[index + 1]!.x - point.x
  })
  const slopes = coordinates.slice(0, -1).map((point, index) => {
    const width = widths[index]!
    return width === 0 ? 0 : (coordinates[index + 1]!.y - point.y) / width
  })
  const tangents = coordinates.map((_, index) => {
    if (index === 0) {
      return slopes[0]!
    }
    if (index === coordinates.length - 1) {
      return slopes.at(-1)!
    }
    const previous = slopes[index - 1]!
    const next = slopes[index]!
    if (
      previous === 0 ||
      next === 0 ||
      Math.sign(previous) !== Math.sign(next)
    ) {
      return 0
    }
    const previousWidth = Math.abs(widths[index - 1]!)
    const nextWidth = Math.abs(widths[index]!)
    const firstWeight = 2 * nextWidth + previousWidth
    const secondWeight = nextWidth + 2 * previousWidth
    return (
      (firstWeight + secondWeight) /
      (firstWeight / previous + secondWeight / next)
    )
  })
  let path = `M${coordinates[0]!.x} ${coordinates[0]!.y}`
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]!
    const end = coordinates[index + 1]!
    const width = widths[index]!
    const controlOneX = start.x + width / 3
    const controlOneY = start.y + (tangents[index]! * width) / 3
    const controlTwoX = end.x - width / 3
    const controlTwoY = end.y - (tangents[index + 1]! * width) / 3
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
    minTime === maxTime
      ? (plot.left + plot.right) / 2
      : plot.left +
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
                if (segment.length) {
                  segments.push(segment)
                }
                segment = []
              } else {
                segment.push(point as NumericStatPoint)
              }
            }
            if (segment.length) {
              segments.push(segment)
            }
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
                          strokeWidth="1.75"
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
                      r="3.5"
                      fill={
                        point.value === null
                          ? 'var(--background)'
                          : colors[field]
                      }
                      stroke={colors[field]}
                      strokeWidth="1.5"
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
      <output
        className="m-0 flex h-10 items-center truncate text-sm text-foreground"
        aria-live="polite"
        title={hovered ? pointSummary(hovered) : undefined}
      >
        {statusText}
      </output>
    </section>
  )
}

export function AttendanceChart({
  points,
  loading,
  statuses,
}: {
  points: DynamicsAttendancePoint[]
  loading: boolean
  statuses: AttendanceStatus[]
}) {
  const [hoveredWeek, setHoveredWeek] =
    useState<DynamicsAttendancePoint | null>(null)
  const sortedPoints = [...points].sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  )
  const timestamps = sortedPoints.map((point) =>
    Date.parse(`${point.weekStart}T00:00:00.000Z`),
  )
  const minTime = timestamps.length ? Math.min(...timestamps) : 0
  const maxTime = timestamps.length ? Math.max(...timestamps) : 1
  const timeRange = maxTime - minTime || 1
  const allValues = sortedPoints.flatMap((point) => [
    point.visited,
    point.missed,
    point.unmarked,
  ])
  const maxValue = Math.max(1, ...allValues)
  const valueRange = maxValue || 1
  const x = (weekStart: string) =>
    minTime === maxTime
      ? (plot.left + plot.right) / 2
      : plot.left +
        ((Date.parse(`${weekStart}T00:00:00.000Z`) - minTime) / timeRange) *
          (plot.right - plot.left)
  const y = (value: number) =>
    plot.bottom - (value / valueRange) * (plot.bottom - plot.top)
  const ticks =
    sortedPoints.length === 0
      ? []
      : minTime === maxTime
        ? [{ at: 0.5, value: minTime }]
        : [
            { at: 0, value: minTime },
            { at: 0.5, value: minTime + timeRange / 2 },
            { at: 1, value: maxTime },
          ]
  const hoveredExists =
    statuses.length > 0 &&
    hoveredWeek &&
    sortedPoints.some((point) => point.weekStart === hoveredWeek.weekStart)
  const statusText = hoveredExists
    ? `Неделя с ${formatDate(hoveredWeek.weekStart)}: посетил — ${hoveredWeek.visited}, не посетил — ${hoveredWeek.missed}, не отметил — ${hoveredWeek.unmarked}`
    : loading
      ? 'Загружаем посещения…'
      : !statuses.length
        ? 'Выберите статус, чтобы показать линию.'
        : sortedPoints.length
          ? 'Наведите на точку, чтобы увидеть итоги недели.'
          : 'За выбранный период закрытых ивентов нет.'
  const series = [
    {
      key: 'visited',
      label: 'Посетил',
      color: 'var(--highlight)',
      legend: 'border-highlight',
    },
    {
      key: 'missed',
      label: 'Не посетил',
      color: 'var(--destructive)',
      legend: 'border-destructive',
    },
    {
      key: 'unmarked',
      label: 'Не отметил',
      color: 'var(--muted-foreground)',
      legend: 'border-muted-foreground',
    },
  ] as const
  const visibleSeries = series.filter((item) => statuses.includes(item.key))

  return (
    <section
      className="grid min-w-0 gap-2 rounded-xl border border-border-accent/70 bg-background/45 p-3"
      aria-label="Посещение ивентов по неделям"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg">Посещение ивентов по неделям</h3>
        <span className="text-sm text-muted-foreground">
          {sortedPoints.length} недель
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <div className="self-end pb-1 text-right text-xs font-medium text-muted-foreground sm:text-sm">
          События
        </div>
        <div />
        <div className="flex flex-col justify-between py-1 text-right text-xs tabular-nums text-muted-foreground sm:text-sm">
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction} className="whitespace-nowrap">
              {numberLabel(maxValue * fraction)}
            </span>
          ))}
        </div>
        <svg
          viewBox="0 0 1000 300"
          preserveAspectRatio="none"
          aria-label="Недельное число событий по статусам"
          className="h-[250px] w-full overflow-visible sm:h-[390px]"
        >
          <defs>
            {visibleSeries.map((item) => (
              <linearGradient
                key={item.key}
                id={`dynamics-area-${item.key}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={item.color} stopOpacity=".38" />
                <stop offset="100%" stopColor={item.color} stopOpacity=".025" />
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
          {visibleSeries.map((item) => {
            const values = sortedPoints.map((point) => ({
              weekStart: point.weekStart,
              value: point[item.key],
            }))
            const segments: { weekStart: string; value: number }[][] = []
            let segment: { weekStart: string; value: number }[] = []
            for (const point of values) {
              const previous = segment.at(-1)
              if (
                previous &&
                Date.parse(`${point.weekStart}T00:00:00.000Z`) -
                  Date.parse(`${previous.weekStart}T00:00:00.000Z`) >
                  7 * 24 * 60 * 60 * 1000
              ) {
                segments.push(segment)
                segment = []
              }
              segment.push(point)
            }
            if (segment.length) {
              segments.push(segment)
            }
            return (
              <g key={item.key}>
                {segments.map((items) => {
                  const linePath = smoothPath(
                    items,
                    (point) => x(point.weekStart),
                    y,
                  )
                  const first = items[0]!
                  const last = items.at(-1)!
                  const areaPath = `${linePath} L${x(last.weekStart)} ${plot.bottom} L${x(first.weekStart)} ${plot.bottom} Z`
                  return (
                    <g key={`${item.key}-${first.weekStart}`}>
                      {items.length > 1 && (
                        <path
                          d={areaPath}
                          fill={`url(#dynamics-area-${item.key})`}
                        />
                      )}
                      {items.length > 1 && (
                        <path
                          d={linePath}
                          fill="none"
                          stroke={item.color}
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                      {items.map((point) => {
                        const week = sortedPoints.find(
                          (row) => row.weekStart === point.weekStart,
                        )!
                        const label = `${item.label}, неделя с ${formatDate(point.weekStart)}: ${numberLabel(point.value)}`
                        return (
                          <circle
                            key={`${item.key}-${point.weekStart}`}
                            cx={x(point.weekStart)}
                            cy={y(point.value)}
                            r="3.5"
                            fill={item.color}
                            stroke="var(--background)"
                            strokeWidth="1.5"
                            aria-label={label}
                            onMouseEnter={() => setHoveredWeek(week)}
                            onMouseLeave={() => setHoveredWeek(null)}
                          />
                        )
                      })}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
        <div className="relative col-start-2 h-6 text-xs tabular-nums text-muted-foreground sm:text-sm">
          {ticks.map((tick) => (
            <span
              key={tick.at}
              className={`absolute whitespace-nowrap ${tick.at === 0 ? 'left-0' : tick.at === 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
            >
              {formatDate(new Date(tick.value).toISOString().slice(0, 10))}
            </span>
          ))}
        </div>
        <div className="col-span-2 text-center text-xs font-medium text-muted-foreground sm:text-sm">
          Неделя
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {visibleSeries.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`w-4 border-t-2 ${item.legend}`}
            />
            {item.label}
          </span>
        ))}
      </div>
      <output
        className="m-0 flex h-10 items-center truncate text-sm text-foreground"
        aria-live="polite"
        title={hoveredExists ? statusText : undefined}
      >
        {statusText}
      </output>
    </section>
  )
}
