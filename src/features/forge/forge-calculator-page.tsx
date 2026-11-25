import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Card } from '@/components/ui/surfaces'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/states/page-header'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { VirtualList, pagingOf } from '@/components/virtual-list'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/session'
import { readStored, writeStored } from '@/lib/storage'
import { TITLE_DEFINITIONS } from '../../../shared/forge/title-definitions'
import { useForgeCatalog } from './api'
import {
  calculateChienkun,
  calculateEquipmentList,
  calculateGods,
  calculateNightWeapon,
  calculateRings,
  calculateRobe,
  calculateTitleStats,
  estimateTitles,
} from '../../../shared/forge/calculations/index'

const calculators = {
  gods: { title: 'Боги', description: 'Опыт и энергия для прокачки божества.' },
  rings: {
    title: 'Кольца',
    description: 'Материалы по ступеням крафта кольца.',
  },
  robe: {
    title: 'Плащ',
    description: 'Расход ресурсов на следующую ступень плаща.',
  },
  equipment: {
    title: 'Эквип',
    description: 'Расчёт материалов для выбранного количества предметов.',
  },
  'night-weapon': {
    title: 'Пуха',
    description: 'Оценка улучшения оружия Вечной Ночи.',
  },
  chienkun: {
    title: 'Мирозданки',
    description: 'Подсчёт камней для заточки и ячеек.',
  },
  titles: {
    title: 'Жребия',
    description: 'Оценка золотых камней жребия для незавершённых уровней.',
  },
} as const
const godProgressSchema = z.object({
  level: z.number().int().min(1).max(105),
  targetLevel: z.number().int().min(1).max(105),
  rank: z.number().int().min(1).max(10),
  targetRank: z.number().int().min(1).max(10),
  energy: z.number().min(0),
})
const weaponSchema = z.object({
  baseScales: z.number().min(0),
  temperedScales: z.number().min(0),
  charms: z.number().min(0),
  baseScalePrice: z.number().min(0),
  charmPrice: z.number().min(0),
  money: z.number().min(0),
  goldPrice: z.number().min(0),
  chestDays: z.number().min(0),
  clanScalesPerWeek: z.number().min(0),
  twins: z.number().min(0),
  mausoleum: z.boolean(),
  mausoleumDouble: z.boolean(),
  donateType: z.union([z.literal(0), z.literal(30), z.literal(40)]),
})
const robeYarnSchema = z.object({
  cloudYarn: z.number().min(0),
  heavenlyYarn: z.number().min(0),
  solarYarn: z.number().min(0),
  moonYarn: z.number().min(0),
  starYarn: z.number().min(0),
})
const ringResourceSchema = z.object({
  polarRings: z.number().min(0),
  quartz: z.number().min(0),
  emeralds: z.number().min(0),
  rubies: z.number().min(0),
  topaz: z.number().min(0),
  temperedAmethyst: z.number().min(0),
})
const robeTimeSchema = z.object({
  hourglassStock: z.number().min(0),
  sundialStock: z.number().min(0),
  hourglassPerWeek: z.number().min(0),
  sundialPerWeek: z.number().min(0),
  arigoraStock: z.number().min(0),
})
const GOD_NAMES = ['Джиро', 'Фью', 'Джоли', 'Шогри', 'Сунджи', 'Джу'] as const
const formSchema = z.object({
  from: z.number().min(0),
  target: z.number().min(0),
  stock: z.number().min(0),
  count: z.number().min(0),
  price: z.number().min(0),
  gods: z.array(godProgressSchema).length(6),
  weapon: weaponSchema,
  robeSource: z.enum(['scratch', 'ascension']),
  robeYarnMethod: z.enum(['hourglass', 'arigora']),
  robeTime: robeTimeSchema,
  robeStocks: robeYarnSchema,
  robePrices: robeYarnSchema,
  ringStocks: ringResourceSchema,
  ringPrices: ringResourceSchema,
  ringEnhancement: z.object({
    refine: z.number().int().min(0).max(12),
    slots: z.number().int().min(0).max(4),
    stones: z.number().int().min(0),
    stonesLevel: z.number().int().min(1).max(14),
    engraves: z.number().int().min(0).max(3),
  }),
  freeExperience: z.number().min(0),
  highStones: z.number().min(0),
  stones: z.number().min(0),
  highStonePrice: z.number().min(0),
  goldPrice: z.number().min(0),
  failureChance: z.number().min(0).max(100),
  stoneType: z.enum(['high', 'normal']),
  donateType: z.union([z.literal(0), z.literal(30), z.literal(40)]),
  titleLevels: z.record(z.string(), z.number().int().min(0).max(7)),
  priorities: z.array(z.string()),
  titleMethod: z.enum(['full', 'priority']),
  equipmentSlot: z.enum(['armor', 'pants', 'boots', 'bracers']),
  equipmentGrade: z.enum([
    'none',
    'r8',
    'r8r',
    'r8r2',
    'r9r2',
    'xx1',
    'xx2',
    'xx3rent',
    'xx3payment',
    'xx3',
    'ts1',
    'ts2',
  ]),
  equipmentTarget: z.enum([
    'none',
    'r8',
    'r8r',
    'r8r2',
    'r9r2',
    'xx1',
    'xx2',
    'xx3rent',
    'xx3payment',
    'xx3',
    'ts1',
    'ts2',
  ]),
  equipmentXX1Path: z.enum(['xx1', 'r8']),
  equipmentXX3Path: z.enum(['xx3', 'rent']),
  equipmentStocks: z.record(z.string(), z.number().min(0)),
  equipmentPrices: z.record(z.string(), z.number().min(0)),
  equipmentItems: z
    .array(
      z.object({
        slot: z.enum(['armor', 'pants', 'boots', 'bracers']),
        grade: z.enum([
          'none',
          'r8',
          'r8r',
          'r8r2',
          'r9r2',
          'xx1',
          'xx2',
          'xx3rent',
          'xx3payment',
          'xx3',
          'ts1',
          'ts2',
        ]),
        targetGrade: z.enum([
          'none',
          'r8',
          'r8r',
          'r8r2',
          'r9r2',
          'xx1',
          'xx2',
          'xx3rent',
          'xx3payment',
          'xx3',
          'ts1',
          'ts2',
        ]),
        xx1Path: z.enum(['xx1', 'r8']),
        xx3Path: z.enum(['xx3', 'rent']),
        count: z.number().min(1),
      }),
    )
    .min(1),
  chienkunLevel: z.number().int().min(1).max(12),
})
type FormValues = z.infer<typeof formSchema>
const emptyValues: FormValues = {
  from: 0,
  target: 1,
  stock: 0,
  count: 1,
  price: 0,
  gods: GOD_NAMES.map(() => ({
    level: 1,
    targetLevel: 105,
    rank: 1,
    targetRank: 10,
    energy: 0,
  })),
  weapon: {
    baseScales: 0,
    temperedScales: 0,
    charms: 0,
    baseScalePrice: 15_000_000,
    charmPrice: 9_500_000,
    money: 0,
    goldPrice: 0,
    chestDays: 0,
    clanScalesPerWeek: 0,
    twins: 0,
    mausoleum: true,
    mausoleumDouble: false,
    donateType: 0,
  },
  robeSource: 'scratch',
  robeYarnMethod: 'hourglass',
  robeTime: {
    hourglassStock: 0,
    sundialStock: 0,
    hourglassPerWeek: 0,
    sundialPerWeek: 0,
    arigoraStock: 0,
  },
  robeStocks: {
    cloudYarn: 0,
    heavenlyYarn: 0,
    solarYarn: 0,
    moonYarn: 0,
    starYarn: 0,
  },
  robePrices: {
    cloudYarn: 0,
    heavenlyYarn: 0,
    solarYarn: 0,
    moonYarn: 0,
    starYarn: 0,
  },
  ringStocks: {
    polarRings: 0,
    quartz: 0,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 0,
  },
  ringPrices: {
    polarRings: 0,
    quartz: 0,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 0,
  },
  ringEnhancement: {
    refine: 0,
    slots: 0,
    stones: 0,
    stonesLevel: 14,
    engraves: 0,
  },
  freeExperience: 0,
  highStones: 0,
  stones: 0,
  highStonePrice: 0,
  goldPrice: 0,
  failureChance: 25,
  stoneType: 'normal',
  donateType: 0,
  titleLevels: {},
  priorities: [],
  titleMethod: 'full',
  equipmentSlot: 'armor',
  equipmentGrade: 'none',
  equipmentTarget: 'r8',
  equipmentXX1Path: 'r8',
  equipmentXX3Path: 'xx3',
  equipmentStocks: {},
  equipmentPrices: {},
  equipmentItems: [
    {
      slot: 'armor',
      grade: 'none',
      targetGrade: 'r8',
      xx1Path: 'r8',
      xx3Path: 'xx3',
      count: 1,
    },
  ],
  chienkunLevel: 1,
}

function readValues(key: string, calculator: string): FormValues {
  const fallback = {
    ...emptyValues,
    count: calculator === 'gods' ? 0 : emptyValues.count,
    price: calculator === 'gods' ? 3_000_000 : emptyValues.price,
    highStonePrice:
      calculator === 'gods' ? 200_000_000 : emptyValues.highStonePrice,
  }
  try {
    const value: unknown = JSON.parse(readStored(key, ['local']) ?? 'null')
    const parsed = formSchema.safeParse(value)
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

function format(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
    value,
  )
}

export function ForgeCalculatorPage({
  calculator,
  search,
  slot,
  onSearchChange,
  onSlotChange,
}: {
  calculator: string
  search: string
  slot: string
  onSearchChange: (search: string) => void
  onSlotChange: (slot: string) => void
}) {
  const config = calculators[calculator as keyof typeof calculators]
  const catalogKind =
    calculator === 'equipment' || calculator === 'titles' ? calculator : null
  const userId = useSession().session?.user.id ?? 'unknown'
  const storageKey = `murr:forge:${userId}:${calculator}`
  const defaults = useMemo(
    () => readValues(storageKey, calculator),
    [storageKey, calculator],
  )
  const [resetOpen, setResetOpen] = useState(false)
  const activeStorageKey = useRef(storageKey)
  const form = useForm({
    defaultValues: defaults,
    validators: { onChange: formSchema },
    onSubmit: async () => undefined,
  })
  const catalog = useForgeCatalog(
    catalogKind ?? 'equipment',
    search,
    slot || undefined,
    catalogKind !== null,
  )

  useEffect(() => {
    form.reset(defaults)
    activeStorageKey.current = storageKey
  }, [defaults, form, storageKey])

  if (!config) {
    return (
      <Card>
        <p>Раздел кузни не найден.</p>
      </Card>
    )
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader title={config.title} description={config.description} />
      <form
        className="grid min-w-0 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.65fr)]">
          <Card className="grid min-w-0 content-start gap-4">
            <h2 className="m-0 font-sans text-base font-bold text-primary">
              Параметры
            </h2>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {(
                [
                  [
                    'from',
                    calculator === 'gods'
                      ? 'Текущий уровень'
                      : 'Текущая ступень',
                  ],
                  [
                    'target',
                    calculator === 'gods'
                      ? 'Желаемый уровень'
                      : 'Желаемая ступень',
                  ],
                  [
                    'stock',
                    calculator === 'gods' ||
                    calculator === 'night-weapon' ||
                    calculator === 'robe' ||
                    calculator === 'rings'
                      ? 'Серебро в наличии'
                      : calculator === 'chienkun'
                        ? 'Заточка'
                        : 'Запас ресурсов',
                  ],
                  [
                    'count',
                    calculator === 'equipment'
                      ? 'Количество предметов'
                      : calculator === 'gods'
                        ? 'Опытные фишки'
                        : calculator === 'titles'
                          ? 'Завершено уровней по списку'
                          : calculator === 'chienkun'
                            ? 'Количество заточек'
                            : 'Дополнительное количество',
                  ],
                  [
                    'price',
                    calculator === 'gods'
                      ? 'Цена обычного камня'
                      : calculator === 'chienkun'
                        ? 'Цена одного камня, юани'
                        : 'Цена за единицу',
                  ],
                ] as const
              )
                .filter(([name]) =>
                  calculator === 'titles'
                    ? false
                    : calculator === 'gods'
                      ? name !== 'from' && name !== 'target'
                      : calculator === 'equipment'
                        ? name !== 'from' &&
                          name !== 'target' &&
                          name !== 'stock' &&
                          name !== 'price' &&
                          name !== 'count'
                        : calculator === 'chienkun'
                          ? name !== 'from' &&
                            name !== 'target' &&
                            name !== 'stock'
                          : calculator === 'night-weapon'
                            ? name !== 'count' && name !== 'price'
                            : calculator === 'robe'
                              ? name !== 'count' && name !== 'price'
                              : calculator === 'rings'
                                ? name !== 'count' && name !== 'price'
                                : true,
                )
                .map(([name, label]) => (
                  <form.Field key={name} name={name}>
                    {(field) => (
                      <label
                        className="grid min-w-0 gap-1 text-sm font-semibold text-foreground"
                        htmlFor={`forge-${name}`}
                      >
                        {label}
                        <Input
                          id={`forge-${name}`}
                          type="number"
                          min="0"
                          max={
                            calculator === 'rings' &&
                            (name === 'from' || name === 'target')
                              ? 6
                              : undefined
                          }
                          step={
                            calculator === 'rings' &&
                            (name === 'from' || name === 'target')
                              ? 1
                              : 'any'
                          }
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(Number(event.target.value))
                          }
                        />
                      </label>
                    )}
                  </form.Field>
                ))}
            </div>
            {calculator === 'gods' && (
              <section
                className="grid min-w-0 gap-3"
                aria-labelledby="forge-gods-title"
              >
                <form.Field name="gods">
                  {(godsField) => (
                    <section
                      className="grid min-w-0 gap-3"
                      aria-labelledby="forge-gods-title"
                    >
                      <h3
                        id="forge-gods-title"
                        className="m-0 font-sans text-sm font-bold text-primary"
                      >
                        Божества: уровень, ранг и энергия
                      </h3>
                      {GOD_NAMES.map((name, index) => {
                        const god = godsField.state.value[index]!
                        return (
                          <fieldset
                            key={name}
                            className="grid min-w-0 gap-2 rounded-xl border border-border p-3"
                          >
                            <legend className="px-1 text-sm font-semibold text-foreground">
                              {name}
                            </legend>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                              {(
                                [
                                  ['level', 'Уровень'],
                                  ['targetLevel', 'Цель уровня'],
                                  ['rank', 'Ранг'],
                                  ['targetRank', 'Цель ранга'],
                                  ['energy', 'Энергия'],
                                ] as const
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                                >
                                  {label}
                                  <Input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={god[key]}
                                    onChange={(event) =>
                                      godsField.handleChange((values) =>
                                        values.map((value, valueIndex) =>
                                          valueIndex === index
                                            ? {
                                                ...value,
                                                [key]: Number(
                                                  event.target.value,
                                                ),
                                              }
                                            : value,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )
                      })}
                    </section>
                  )}
                </form.Field>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(
                    [
                      ['freeExperience', 'Свободный опыт'],
                      ['highStones', 'Высшие камни в наличии'],
                      ['stones', 'Обычные камни в наличии'],
                      ['highStonePrice', 'Цена высшего камня'],
                      ['goldPrice', 'Цена голда'],
                      ['failureChance', 'Шанс неудачи, %'],
                    ] as const
                  ).map(([name, label]) => (
                    <form.Field key={name} name={name}>
                      {(field) => (
                        <label className="grid min-w-0 gap-1 text-sm font-semibold text-foreground">
                          {label}
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(Number(event.target.value))
                            }
                          />
                        </label>
                      )}
                    </form.Field>
                  ))}
                  <label className="grid gap-1 text-sm font-semibold">
                    Тип камня
                    <select
                      className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                      value={form.state.values.stoneType}
                      onChange={(event) =>
                        form.setFieldValue(
                          'stoneType',
                          event.target.value as 'high' | 'normal',
                        )
                      }
                    >
                      <option value="normal">Обычный</option>
                      <option value="high">Высший</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Скидка золота
                    <select
                      className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                      value={form.state.values.donateType}
                      onChange={(event) =>
                        form.setFieldValue(
                          'donateType',
                          Number(event.target.value) as 0 | 30 | 40,
                        )
                      }
                    >
                      <option value="0">Без скидки</option>
                      <option value="30">30%</option>
                      <option value="40">40%</option>
                    </select>
                  </label>
                </div>
              </section>
            )}
            {calculator === 'robe' && (
              <section
                className="grid min-w-0 gap-3"
                aria-labelledby="forge-robe-title"
              >
                <h3
                  id="forge-robe-title"
                  className="m-0 font-sans text-sm font-bold text-primary"
                >
                  Пряжа и цены
                </h3>
                <label className="grid gap-1 text-sm font-semibold">
                  Путь создания
                  <select
                    className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                    value={form.state.values.robeSource}
                    onChange={(event) =>
                      form.setFieldValue(
                        'robeSource',
                        event.target.value as 'scratch' | 'ascension',
                      )
                    }
                  >
                    <option value="scratch">С нуля</option>
                    <option value="ascension">Из плаща вознесения</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Получение пряжи времени
                  <select
                    className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                    value={form.state.values.robeYarnMethod}
                    onChange={(event) =>
                      form.setFieldValue(
                        'robeYarnMethod',
                        event.target.value as 'hourglass' | 'arigora',
                      )
                    }
                  >
                    <option value="hourglass">
                      За песочные и солнечные часы
                    </option>
                    <option value="arigora">За монеты Аригоры</option>
                  </select>
                </label>
                <form.Field name="robeStocks">
                  {(stockField) => (
                    <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                      <legend className="mb-2 text-sm font-semibold">
                        Пряжа в наличии
                      </legend>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {(
                          [
                            ['cloudYarn', 'Облачная пряжа'],
                            ['heavenlyYarn', 'Небесная пряжа'],
                            ['solarYarn', 'Солнечная пряжа'],
                            ['moonYarn', 'Лунная пряжа'],
                            ['starYarn', 'Звёздная пряжа'],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                          >
                            {label}
                            <Input
                              type="number"
                              min="0"
                              value={stockField.state.value[key]}
                              onChange={(event) =>
                                stockField.handleChange((values) => ({
                                  ...values,
                                  [key]: Number(event.target.value),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </form.Field>
                <form.Field name="robePrices">
                  {(priceField) => (
                    <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                      <legend className="mb-2 text-sm font-semibold">
                        Цена пряжи
                      </legend>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {(
                          [
                            ['cloudYarn', 'Облачная пряжа'],
                            ['heavenlyYarn', 'Небесная пряжа'],
                            ['solarYarn', 'Солнечная пряжа'],
                            ['moonYarn', 'Лунная пряжа'],
                            ['starYarn', 'Звёздная пряжа'],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                          >
                            {label}
                            <Input
                              type="number"
                              min="0"
                              value={priceField.state.value[key]}
                              onChange={(event) =>
                                priceField.handleChange((values) => ({
                                  ...values,
                                  [key]: Number(event.target.value),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </form.Field>
                <form.Field name="robeTime">
                  {(timeField) => (
                    <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                      <legend className="mb-2 text-sm font-semibold">
                        Запас и недельный фарм
                      </legend>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {(form.state.values.robeYarnMethod === 'hourglass'
                          ? [
                              ['hourglassStock', 'Песочные часы в наличии'],
                              ['sundialStock', 'Солнечные часы в наличии'],
                              ['hourglassPerWeek', 'Песочные часы в неделю'],
                              ['sundialPerWeek', 'Солнечные часы в неделю'],
                            ]
                          : [['arigoraStock', 'Монеты Аригоры в наличии']]
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                          >
                            {label}
                            <Input
                              type="number"
                              min="0"
                              value={
                                timeField.state.value[
                                  key as keyof typeof timeField.state.value
                                ]
                              }
                              onChange={(event) =>
                                timeField.handleChange((value) => ({
                                  ...value,
                                  [key as keyof typeof value]: Number(
                                    event.target.value,
                                  ),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </form.Field>
              </section>
            )}
            {calculator === 'rings' && (
              <section
                className="grid min-w-0 gap-3"
                aria-label="Запас и цены для колец"
              >
                <form.Field name="ringEnhancement">
                  {(field) => (
                    <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                      <legend className="mb-2 text-sm font-semibold">
                        Заточка, ячейки и гравировки
                      </legend>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        {(
                          [
                            ['refine', 'Заточка +0…+12'],
                            ['slots', 'Ячеек (1…4)'],
                            ['stones', 'Камней в ячейках'],
                            ['stonesLevel', 'Уровень камня (1…14)'],
                            ['engraves', 'Уровень гравировки (1…3)'],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                          >
                            {label}
                            <Input
                              type="number"
                              min="0"
                              value={field.state.value[key]}
                              onChange={(event) =>
                                field.handleChange((value) => ({
                                  ...value,
                                  [key]: Number(event.target.value),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </form.Field>
                {(['ringStocks', 'ringPrices'] as const).map((name) => (
                  <form.Field key={name} name={name}>
                    {(field) => (
                      <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                        <legend className="mb-2 text-sm font-semibold">
                          {name === 'ringStocks'
                            ? 'Ресурсы в наличии'
                            : 'Цена ресурсов'}
                        </legend>
                        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {(
                            [
                              ['polarRings', 'Полярные кольца'],
                              ['quartz', 'Кварц'],
                              ['emeralds', 'Изумруд'],
                              ['rubies', 'Рубин'],
                              ['topaz', 'Топаз'],
                              ['temperedAmethyst', 'Закалённый аметист'],
                            ] as const
                          ).map(([key, label]) => (
                            <label
                              key={key}
                              className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground"
                            >
                              {label}
                              <Input
                                type="number"
                                min="0"
                                value={field.state.value[key]}
                                onChange={(event) =>
                                  field.handleChange((value) => ({
                                    ...value,
                                    [key]: Number(event.target.value),
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </form.Field>
                ))}
              </section>
            )}
            {calculator === 'equipment' && (
              <section
                className="grid min-w-0 gap-3"
                aria-label="Параметры эквипа"
              >
                <Button
                  type="button"
                  variant="secondary"
                  className="w-fit"
                  onClick={() =>
                    form.setFieldValue('equipmentItems', [
                      ...form.state.values.equipmentItems,
                      {
                        slot: 'armor',
                        grade: 'none',
                        targetGrade: 'r8',
                        xx1Path: 'r8',
                        xx3Path: 'xx3',
                        count: 1,
                      },
                    ])
                  }
                >
                  Добавить предмет
                </Button>
                <form.Field name="equipmentItems">
                  {(itemsField) => (
                    <div className="grid min-w-0 gap-3">
                      {itemsField.state.value.map((item, index) => (
                        <fieldset
                          key={index}
                          className="grid min-w-0 gap-3 rounded-xl border border-border p-3"
                        >
                          <legend className="px-1 text-sm font-semibold">
                            Предмет {index + 1}
                          </legend>
                          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <label className="grid gap-1 text-xs font-semibold">
                              Слот
                              <select
                                className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2 text-foreground"
                                value={item.slot}
                                onChange={(event) =>
                                  itemsField.handleChange((items) =>
                                    items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? {
                                            ...row,
                                            slot: event.target
                                              .value as FormValues['equipmentSlot'],
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              >
                                <option value="armor">Верх</option>
                                <option value="pants">Поножи</option>
                                <option value="boots">Сапоги</option>
                                <option value="bracers">Наручи</option>
                              </select>
                            </label>
                            {(['grade', 'targetGrade'] as const).map((name) => (
                              <label
                                key={name}
                                className="grid gap-1 text-xs font-semibold"
                              >
                                {name === 'grade' ? 'Сейчас' : 'Цель'}
                                <select
                                  className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2 text-foreground"
                                  value={item[name]}
                                  onChange={(event) =>
                                    itemsField.handleChange((items) =>
                                      items.map((row, rowIndex) =>
                                        rowIndex === index
                                          ? {
                                              ...row,
                                              [name]: event.target
                                                .value as FormValues['equipmentGrade'],
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                >
                                  {[
                                    ['none', 'Нет'],
                                    ['r8', 'р8'],
                                    ['r8r', 'р8р'],
                                    ['r8r2', 'р8р2'],
                                    ['r9r2', 'р9р2'],
                                    ['xx1', 'ХХ1'],
                                    ['xx2', 'ХХ2'],
                                    ['xx3rent', 'Аренда ХХ3'],
                                    ['xx3payment', 'Аренда ХХ3 (платёж)'],
                                    ['xx3', 'ХХ3'],
                                    ['ts1', 'ТС1'],
                                    ['ts2', 'ТС2'],
                                  ].map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                            <label
                              htmlFor={`forge-equipment-count-${index}`}
                              className="grid gap-1 text-xs font-semibold"
                            >
                              Количество
                              <Input
                                id={`forge-equipment-count-${index}`}
                                type="number"
                                min="1"
                                step="1"
                                value={item.count}
                                onChange={(event) =>
                                  itemsField.handleChange((items) =>
                                    items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? {
                                            ...row,
                                            count: Number(event.target.value),
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold">
                              Путь к ХХ1
                              <select
                                className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2 text-foreground"
                                value={item.xx1Path}
                                onChange={(event) =>
                                  itemsField.handleChange((items) =>
                                    items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? {
                                            ...row,
                                            xx1Path: event.target
                                              .value as FormValues['equipmentXX1Path'],
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              >
                                <option value="r8">Через р8-р9р2</option>
                                <option value="xx1">Напрямую в ХХ1</option>
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs font-semibold">
                              Путь к ХХ3
                              <select
                                className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2 text-foreground"
                                value={item.xx3Path}
                                onChange={(event) =>
                                  itemsField.handleChange((items) =>
                                    items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? {
                                            ...row,
                                            xx3Path: event.target
                                              .value as FormValues['equipmentXX3Path'],
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              >
                                <option value="xx3">Полный ХХ3</option>
                                <option value="rent">Аренда ХХ3</option>
                              </select>
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-fit self-end"
                              disabled={itemsField.state.value.length <= 1}
                              onClick={() =>
                                itemsField.handleChange((items) =>
                                  items.filter(
                                    (_, rowIndex) => rowIndex !== index,
                                  ),
                                )
                              }
                            >
                              Удалить предмет
                            </Button>
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  )}
                </form.Field>
                {(() => {
                  const recipe = calculateEquipmentList({
                    items: form.state.values.equipmentItems,
                  })
                  return recipe.supported &&
                    Object.keys(recipe.required).length > 0 ? (
                    <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                      <legend className="text-sm font-semibold">
                        Запас и цены материалов
                      </legend>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {Object.keys(recipe.required).map((key) => (
                          <div
                            key={key}
                            className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border border-border p-2"
                          >
                            <strong className="col-span-2 break-words text-xs">
                              {key}
                            </strong>
                            <label
                              htmlFor={`forge-equipment-stock-${key}`}
                              className="grid min-w-0 gap-1 text-xs text-muted-foreground"
                            >
                              Есть
                              <Input
                                id={`forge-equipment-stock-${key}`}
                                type="number"
                                min="0"
                                value={
                                  form.state.values.equipmentStocks[key] ?? 0
                                }
                                onChange={(event) =>
                                  form.setFieldValue('equipmentStocks', {
                                    ...form.state.values.equipmentStocks,
                                    [key]: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label
                              htmlFor={`forge-equipment-price-${key}`}
                              className="grid min-w-0 gap-1 text-xs text-muted-foreground"
                            >
                              Цена за шт.
                              <Input
                                id={`forge-equipment-price-${key}`}
                                type="number"
                                min="0"
                                value={
                                  form.state.values.equipmentPrices[key] ?? 0
                                }
                                onChange={(event) =>
                                  form.setFieldValue('equipmentPrices', {
                                    ...form.state.values.equipmentPrices,
                                    [key]: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  ) : null
                })()}
              </section>
            )}
            {calculator === 'chienkun' && (
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label
                  htmlFor="forge-chienkun-level"
                  className="grid gap-1 text-sm font-semibold"
                >
                  Уровень заточки
                  <Input
                    id="forge-chienkun-level"
                    type="number"
                    min="1"
                    max="12"
                    step="1"
                    value={form.state.values.chienkunLevel}
                    onChange={(event) =>
                      form.setFieldValue(
                        'chienkunLevel',
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label
                  htmlFor="forge-chienkun-gold-price"
                  className="grid gap-1 text-sm font-semibold"
                >
                  Цена голда, юани
                  <Input
                    id="forge-chienkun-gold-price"
                    type="number"
                    min="0"
                    value={form.state.values.goldPrice}
                    onChange={(event) =>
                      form.setFieldValue(
                        'goldPrice',
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
              </div>
            )}
            {calculator === 'night-weapon' && (
              <form.Field name="weapon">
                {(weaponField) => (
                  <section
                    className="grid min-w-0 gap-3"
                    aria-labelledby="forge-weapon-title"
                  >
                    <h3
                      id="forge-weapon-title"
                      className="m-0 font-sans text-sm font-bold text-primary"
                    >
                      Чешуя, расходы и фарм
                    </h3>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {(
                        [
                          ['baseScales', 'Обычная чешуя в наличии'],
                          ['temperedScales', 'Закалённая чешуя в наличии'],
                          ['charms', 'Амулеты в наличии'],
                          ['baseScalePrice', 'Цена обычной чешуи'],
                          ['charmPrice', 'Цена амулета'],
                          ['money', 'Юани в наличии'],
                          ['goldPrice', 'Цена голда'],
                          ['chestDays', 'Дней открытия сундуков'],
                          ['clanScalesPerWeek', 'Чешуи из клан-холла в неделю'],
                          ['twins', 'Количество твинов'],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="grid min-w-0 gap-1 text-sm font-semibold text-foreground"
                        >
                          {label}
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={weaponField.state.value[key]}
                            onChange={(event) =>
                              weaponField.handleChange((values) => ({
                                ...values,
                                [key]: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                      ))}
                      {(
                        [
                          ['mausoleum', 'Фарм в мавзолее'],
                          ['mausoleumDouble', 'Двойная награда'],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex min-w-0 items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={weaponField.state.value[key]}
                            onChange={(event) =>
                              weaponField.handleChange((values) => ({
                                ...values,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                      <label className="grid gap-1 text-sm font-semibold">
                        Скидка золота
                        <select
                          className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                          value={weaponField.state.value.donateType}
                          onChange={(event) =>
                            weaponField.handleChange((values) => ({
                              ...values,
                              donateType: Number(event.target.value) as
                                0 | 30 | 40,
                            }))
                          }
                        >
                          <option value="0">Без скидки</option>
                          <option value="30">30%</option>
                          <option value="40">40%</option>
                        </select>
                      </label>
                    </div>
                  </section>
                )}
              </form.Field>
            )}
            {calculator === 'titles' && (
              <div className="grid min-w-0 gap-3">
                <label className="grid gap-1 text-sm font-semibold text-foreground">
                  Режим расчёта
                  <select
                    className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                    value={form.state.values.titleMethod}
                    onChange={(event) =>
                      form.setFieldValue(
                        'titleMethod',
                        event.target.value as 'full' | 'priority',
                      )
                    }
                  >
                    <option value="full">Полная прокачка</option>
                    <option value="priority">Только приоритетные</option>
                  </select>
                </label>
                <fieldset className="grid min-w-0 gap-2 border-0 p-0">
                  <legend className="mb-2 text-sm font-semibold text-foreground">
                    Приоритетные характеристики
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['hp', 'Здоровье'],
                      ['pa', 'ПА'],
                      ['pz', 'ПЗ'],
                      ['patk', 'Физ. урон'],
                      ['matk', 'Маг. урон'],
                      ['pdef', 'Физ. деф'],
                      ['mdef', 'Маг. защита'],
                    ].map(([id, label]) => (
                      <label
                        key={id}
                        className="flex min-w-0 items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={form.state.values.priorities.includes(id!)}
                          onChange={(event) =>
                            form.setFieldValue(
                              'priorities',
                              event.target.checked
                                ? [...form.state.values.priorities, id!]
                                : form.state.values.priorities.filter(
                                    (value) => value !== id,
                                  ),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-fit"
                  onClick={() => setResetOpen(true)}
                >
                  Сбросить титулы
                </Button>
                <ConfirmActionDialog
                  open={resetOpen}
                  onOpenChange={setResetOpen}
                  title="Сбросить отметки титулов?"
                  description="Все отметки прохождения титулов будут очищены. Приоритеты и режим расчёта сохранятся."
                  confirmLabel="Сбросить"
                  pendingLabel="Сбрасываем…"
                  onConfirm={async () => {
                    form.setFieldValue('titleLevels', {})
                  }}
                />
              </div>
            )}
            {catalogKind && (
              <section
                className="grid min-w-0 gap-3"
                aria-labelledby="forge-catalog-title"
              >
                <h3
                  id="forge-catalog-title"
                  className="m-0 font-sans text-sm font-bold text-primary"
                >
                  Каталог
                </h3>
                <Input
                  type="search"
                  aria-label="Поиск по каталогу"
                  placeholder="Введите название"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
                {catalogKind === 'equipment' && (
                  <label className="grid gap-1 text-sm font-semibold">
                    Слот
                    <select
                      className="w-full min-w-0 rounded-lg border border-input bg-input-background px-3 py-2.5 text-foreground"
                      value={slot}
                      onChange={(event) => onSlotChange(event.target.value)}
                    >
                      <option value="">Все слоты</option>
                      <option value="armor">Верх</option>
                      <option value="pants">Поножи</option>
                      <option value="boots">Сапоги</option>
                      <option value="bracers">Наручи</option>
                    </select>
                  </label>
                )}
                {catalog.isPending ? (
                  <LoadingState label="Загружаем каталог…" />
                ) : catalog.isError ? (
                  <ErrorState onRetry={() => void catalog.refetch()} />
                ) : catalog.data.length === 0 ? (
                  <EmptyState
                    title="Ничего не найдено"
                    description="Измените запрос поиска."
                  />
                ) : (
                  <form.Subscribe selector={(state) => state.values}>
                    {(values) => (
                      <VirtualList
                        items={catalog.data}
                        getKey={(item) => item.id}
                        label="Каталог кузни"
                        estimateSize={64}
                        paging={pagingOf(catalog)}
                        renderItem={(item) => {
                          if (calculator !== 'titles') {
                            return (
                              <button
                                type="button"
                                className="w-full min-w-0 rounded-xl border border-border bg-card p-3 text-left text-sm text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-pressed={
                                  values.equipmentItems.at(-1)?.slot ===
                                    item.slot &&
                                  values.equipmentItems.at(-1)?.targetGrade ===
                                    item.detail.grade
                                }
                                onClick={() => {
                                  if (
                                    item.slot &&
                                    typeof item.detail.grade === 'string'
                                  ) {
                                    form.setFieldValue(
                                      'equipmentItems',
                                      (rows) =>
                                        rows.map((row, rowIndex) =>
                                          rowIndex === rows.length - 1
                                            ? {
                                                ...row,
                                                slot: item.slot as FormValues['equipmentSlot'],
                                                targetGrade: item.detail
                                                  .grade as FormValues['equipmentTarget'],
                                              }
                                            : row,
                                        ),
                                    )
                                  }
                                }}
                              >
                                <strong>{item.name}</strong>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  Нажмите, чтобы выбрать цель улучшения
                                </span>
                              </button>
                            )
                          }
                          const titleId = String(item.detail.itemId)
                          const level = Number(item.detail.level)
                          const checked =
                            (values.titleLevels[titleId] ?? 0) >= level
                          return (
                            <label className="flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                aria-label={`${item.name} пройден`}
                                onChange={(event) =>
                                  form.setFieldValue('titleLevels', {
                                    ...values.titleLevels,
                                    [titleId]: event.target.checked
                                      ? level
                                      : level - 1,
                                  })
                                }
                              />
                              <span className="min-w-0 break-words">
                                {item.name}
                                <span className="block text-xs text-muted-foreground">
                                  {String(item.detail.stat ?? '')}
                                </span>
                              </span>
                            </label>
                          )
                        }}
                      />
                    )}
                  </form.Subscribe>
                )}
              </section>
            )}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <PersistValues
                  storageKey={storageKey}
                  activeStorageKey={activeStorageKey.current}
                  values={values}
                />
              )}
            </form.Subscribe>
          </Card>
          <Card className="grid min-w-0 content-start gap-3">
            <h2 className="m-0 font-sans text-base font-bold text-primary">
              Расчёт
            </h2>
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <ForgeResult calculator={calculator} values={values} />
              )}
            </form.Subscribe>
          </Card>
        </div>
      </form>
    </div>
  )
}

function PersistValues({
  storageKey,
  activeStorageKey,
  values,
}: {
  storageKey: string
  activeStorageKey: string
  values: FormValues
}) {
  useEffect(() => {
    if (activeStorageKey === storageKey) {
      writeStored(storageKey, JSON.stringify(values), ['local'])
    }
  }, [activeStorageKey, storageKey, values])
  return null
}

function ForgeResult({
  calculator,
  values,
}: {
  calculator: string
  values: FormValues
}) {
  if (
    ['rings', 'robe', 'night-weapon'].includes(calculator) &&
    values.target < values.from
  ) {
    return (
      <p className="m-0 text-sm text-destructive">
        Целевая ступень ниже текущей — улучшение невозможно.
      </p>
    )
  }
  if (
    calculator === 'gods' &&
    values.gods.some(
      (god) => god.targetLevel < god.level || god.targetRank < god.rank,
    )
  ) {
    return (
      <p className="m-0 text-sm text-destructive">
        У одного из божеств цель ниже текущего уровня или ранга.
      </p>
    )
  }
  if (calculator === 'robe') {
    const result = calculateRobe({
      grade: values.from,
      targetGrade: values.target,
      source: values.robeSource,
      yarnMethod: values.robeYarnMethod,
      silverStock: values.stock,
      stock: values.robeStocks,
      prices: values.robePrices,
      ...values.robeTime,
    })
    const yarnLabels = {
      cloudYarn: 'Облачная',
      heavenlyYarn: 'Небесная',
      solarYarn: 'Солнечная',
      moonYarn: 'Лунная',
      starYarn: 'Звёздная',
    } as const
    return (
      <div className="grid min-w-0 gap-3">
        <p className="m-0 text-sm tabular-nums">
          Серебро: <strong>{format(result.silverNeeded)}</strong> · всего
          ресурсов: <strong>{format(result.materialsNeeded)}</strong>
        </p>
        <div className="grid min-w-0 gap-2">
          {Object.entries(yarnLabels).map(([key, label]) => (
            <div
              key={key}
              className="grid min-w-0 grid-cols-2 gap-2 border-b border-border py-2 text-xs tabular-nums sm:grid-cols-4"
            >
              <span className="min-w-0 break-words">{label} пряжа</span>
              <span className="min-w-0 break-words">
                Нужно{' '}
                {format(result.required[key as keyof typeof result.required])}
              </span>
              <span className="min-w-0 break-words">
                Есть{' '}
                {format(
                  values.robeStocks[key as keyof typeof values.robeStocks],
                )}
              </span>
              <strong className="min-w-0 break-words">
                Не хватает{' '}
                {format(result.missing[key as keyof typeof result.missing])}
              </strong>
            </div>
          ))}
        </div>
        <p className="m-0 text-sm tabular-nums">
          Ориентировочная сумма с введёнными ценами:{' '}
          <strong>{format(result.totalCost)}</strong>
        </p>
        {result.steps.map((step) => (
          <div
            key={step.targetGrade}
            className="grid min-w-0 gap-1 rounded-lg border border-border p-2 text-xs tabular-nums"
          >
            <strong>
              До грейда {step.targetGrade}: серебро {format(step.silver)}
            </strong>
            <span className="break-words">
              {Object.entries(yarnLabels)
                .filter(
                  ([key]) =>
                    step.required[key as keyof typeof step.required] > 0,
                )
                .map(
                  ([key, label]) =>
                    `${label}: ${format(step.required[key as keyof typeof step.required])}`,
                )
                .join(' · ')}
            </span>
          </div>
        ))}
        {values.robeYarnMethod === 'hourglass' ? (
          <p className="m-0 text-sm tabular-nums">
            Часы для пряжи: песочные{' '}
            <strong>{format(result.hourglassNeeded)}</strong>, солнечные{' '}
            <strong>{format(result.sundialNeeded)}</strong>. Недель фарма:{' '}
            <strong>
              {result.farmWeeks === null
                ? 'укажите недельный фарм'
                : format(result.farmWeeks)}
            </strong>
          </p>
        ) : (
          <p className="m-0 text-sm tabular-nums">
            Монет Аригоры не хватает:{' '}
            <strong>{format(result.arigoraNeeded)}</strong>
          </p>
        )}
      </div>
    )
  }
  if (calculator === 'night-weapon') {
    const result = calculateNightWeapon({
      grade: values.from,
      targetGrade: values.target,
      silver: values.stock,
      ...values.weapon,
    })
    return (
      <div className="grid min-w-0 gap-2 text-sm tabular-nums">
        <p className="m-0">
          Обычной чешуи не хватает:{' '}
          <strong>{format(result.scalesNeeded)}</strong>
        </p>
        <p className="m-0">
          Закалённой чешуи не хватает:{' '}
          <strong>{format(result.temperedScalesNeeded)}</strong>
        </p>
        <p className="m-0">
          Амулетов не хватает: <strong>{format(result.charmsNeeded)}</strong>
        </p>
        <p className="m-0">
          Серебро: <strong>{format(result.silverNeeded)}</strong> · стоимость
          материалов: <strong>{format(result.cost)}</strong>
        </p>
        <p className="m-0">
          Голд: <strong>{format(result.gold)}</strong> · рубли:{' '}
          <strong>{format(result.rubles)}</strong>
        </p>
        <p className="m-0">
          Дней фарма:{' '}
          <strong>
            {result.farmDays === null
              ? 'нет заданного фарма'
              : format(result.farmDays)}
          </strong>
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Расчёт предполагает крафт со 100% шансом.
        </p>
      </div>
    )
  }
  if (calculator === 'gods') {
    const result = calculateGods({
      gods: values.gods,
      silver: values.stock,
      experience: values.freeExperience,
      chips: values.count,
      highStones: values.highStones,
      stones: values.stones,
      stoneType: values.stoneType,
      highStonePrice: values.highStonePrice,
      stonePrice: values.price,
      goldPrice: values.goldPrice,
      failureChance: values.failureChance,
      donateType: values.donateType,
    })
    return (
      <div className="grid min-w-0 gap-2 text-sm tabular-nums">
        <p className="m-0">
          Серебро на выбранные уровни:{' '}
          <strong>{format(result.levelSilverCost)}</strong>
        </p>
        <p className="m-0">
          Осталось серебра: <strong>{format(result.silverNeeded)}</strong>
        </p>
        <p className="m-0">
          Недостающая энергия с учётом неудач:{' '}
          <strong>{format(result.energyNeeded)}</strong>
        </p>
        <p className="m-0">
          Камней выбранного типа:{' '}
          <strong>{format(result.stoneQuantity)}</strong> · стоимость:{' '}
          <strong>{format(result.stoneCost)}</strong>
        </p>
        <p className="m-0">
          Голд: <strong>{format(result.gold)}</strong> · рубли:{' '}
          <strong>{format(result.rubles)}</strong>
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Количество камней и итоговая стоимость — оценка с учётом указанного
          шанса неудачи.
        </p>
      </div>
    )
  }
  if (calculator === 'titles') {
    const checkedLevels = Object.fromEntries(
      TITLE_DEFINITIONS.map((title) => [
        title.id,
        values.titleLevels[String(title.id)] ?? 0,
      ]),
    )
    const estimate = estimateTitles({
      checkedLevels,
      priorities: values.priorities,
      method: values.titleMethod,
    })
    const stats = calculateTitleStats(checkedLevels)
    return (
      <div className="grid min-w-0 gap-3">
        <p className="m-0 break-words text-base font-semibold tabular-nums text-foreground">
          {values.titleMethod === 'priority' && values.priorities.length === 0
            ? 'Выберите приоритетные характеристики.'
            : `Пройдено уровней: ${format(168 - estimate.levelsRemaining)} из 168 · жребия: ${format(estimate.optimistic)} / ${format(estimate.average)} / ${format(estimate.conservative)}`}
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Оценки случайного процесса: оптимистичная / средняя / осторожная.
        </p>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.stat}
              className="min-w-0 rounded-lg border border-border p-2"
            >
              <span className="block text-xs text-muted-foreground">
                {
                  (
                    {
                      hp: 'Здоровье',
                      pa: 'ПА',
                      pz: 'ПЗ',
                      patk: 'Физ. атака',
                      matk: 'Маг. атака',
                      pdef: 'Физ. деф',
                      mdef: 'Маг. деф',
                    } as Record<string, string>
                  )[stat.stat]
                }
              </span>
              <strong className="break-words tabular-nums">
                {format(stat.current)} / {format(stat.maximum)}
              </strong>
            </div>
          ))}
        </div>
      </div>
    )
  }
  const result = (() => {
    if (calculator === 'rings') {
      const data = calculateRings({
        grade: values.from,
        targetGrade: values.target,
        stock: values.ringStocks,
        prices: values.ringPrices,
        enhancement: values.ringEnhancement,
        silverStock: values.stock,
      })
      const ringLabels: Record<string, string> = {
        polarRings: 'Полярные кольца',
        quartz: 'Кварц',
        emeralds: 'Изумруд',
        rubies: 'Рубин',
        topaz: 'Топаз',
        temperedAmethyst: 'Закалённый аметист',
      }
      return (
        <div className="grid min-w-0 gap-2 text-sm tabular-nums">
          <p className="m-0">
            Серебро не хватает: <strong>{format(data.silverNeeded)}</strong> ·
            материалы не хватает:{' '}
            <strong>{format(data.materialsNeeded)}</strong>
          </p>
          {Object.entries(data.missing)
            .filter(([, amount]) => amount > 0)
            .map(([name, amount]) => (
              <p key={name} className="m-0 break-words">
                {ringLabels[name] ?? name}: <strong>{format(amount)}</strong>
              </p>
            ))}
          <p className="m-0">
            Расчётная сумма по введённым ценам:{' '}
            <strong>{format(data.totalCost)}</strong>
          </p>
          <p className="m-0">
            Для заточки, ячеек, камней и гравировки:{' '}
            {format(data.enhancement.refine)} заточных камней ·{' '}
            {format(data.enhancement.slots)} камней на ячейки ·{' '}
            {format(data.enhancement.stones)} камней выбранного уровня ·{' '}
            {format(data.enhancement.engraves)} камней гравировки
          </p>
        </div>
      )
    }
    if (calculator === 'equipment') {
      const result = calculateEquipmentList({
        items: values.equipmentItems,
        stock: values.equipmentStocks,
        prices: values.equipmentPrices,
      })
      return result.supported ? (
        <div className="grid min-w-0 gap-2 text-sm tabular-nums">
          <p className="m-0">
            Не хватает материалов:{' '}
            <strong>{format(result.materialsNeeded)}</strong> · серебра:{' '}
            <strong>{format(result.silverNeeded)}</strong>
          </p>
          <p className="m-0">
            Стоимость по введённым ценам:{' '}
            <strong>{format(result.totalCost)}</strong>
          </p>
          {Object.entries(result.missing)
            .filter(([, amount]) => amount > 0)
            .map(([name, amount]) => (
              <p key={name} className="m-0 break-words">
                {name}: <strong>{format(amount)}</strong>
              </p>
            ))}
        </div>
      ) : (
        'Для этой комбинации ступеней рецепт не найден.'
      )
    }
    if (calculator === 'chienkun') {
      const result = calculateChienkun({
        level: values.chienkunLevel,
        quantity: values.count,
        purchasePrice: values.price,
        goldPrice: values.goldPrice,
      })
      return (
        <div className="grid min-w-0 gap-2 text-sm tabular-nums">
          <p className="m-0">
            Камней мироздания: <strong>{format(result.stonesNeeded)}</strong>
          </p>
          <p className="m-0">
            Покупка за юани: <strong>{format(result.yuanMarket)} млн</strong>
          </p>
          <p className="m-0">
            Голд без распродажи: <strong>{format(result.goldNormal)}</strong> ·
            примерно {format(result.rublesNormal)} ₽ /{' '}
            {format(result.yuanNormalGold)} млн юаней
          </p>
          <p className="m-0">
            Голд на распродаже: <strong>{format(result.goldSale)}</strong> ·
            примерно {format(result.rublesSale)} ₽ /{' '}
            {format(result.yuanSaleGold)} млн юаней
          </p>
          <h3 className="mb-0 mt-3 font-sans text-sm font-bold text-primary">
            Таблица по уровням
          </h3>
          <div className="grid min-w-0 gap-2">
            {Array.from({ length: 12 }, (_, index) => index + 1).map(
              (level) => {
                const row = calculateChienkun({
                  level,
                  quantity: values.count,
                  purchasePrice: values.price,
                  goldPrice: values.goldPrice,
                })
                return (
                  <div
                    key={level}
                    className={`grid min-w-0 gap-1 rounded-lg border p-2 text-xs tabular-nums ${level === values.chienkunLevel ? 'border-primary bg-muted' : 'border-border'}`}
                  >
                    <strong>
                      Заточка +{level}: {format(row.stonesNeeded)} камней
                    </strong>
                    <span className="break-words">
                      Рынок: {format(row.yuanMarket)} млн юаней · обычный голд:{' '}
                      {format(row.goldNormal)} · распродажа:{' '}
                      {format(row.goldSale)}
                    </span>
                  </div>
                )
              },
            )}
          </div>
        </div>
      )
    }
    return 'Выберите калькулятор в меню «Калькулятор».'
  })()
  return (
    <div className="m-0 break-words text-lg font-semibold tabular-nums text-foreground">
      {result}
    </div>
  )
}
