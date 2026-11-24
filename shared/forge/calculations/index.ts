import { GOD_LEVEL_EXPERIENCE } from '../catalogs.ts'
export type GodProgress = {
  level: number
  targetLevel: number
  rank: number
  targetRank: number
  energy: number
}
export type GodsInput = {
  gods: readonly GodProgress[]
  silver: number
  experience: number
  chips: number
  highStones: number
  stones: number
  stoneType: 'high' | 'normal'
  highStonePrice: number
  stonePrice: number
  goldPrice: number
  failureChance: number
  donateType: 0 | 30 | 40
}
export type GodsResult = {
  levelSilverCost: number
  silverNeeded: number
  energyNeeded: number
  stoneQuantity: number
  stoneCost: number
  gold: number
  rubles: number
}
export type RingMaterial =
  'polarRings' | 'quartz' | 'emeralds' | 'rubies' | 'topaz' | 'temperedAmethyst'
export type RingEnhancementInput = {
  refine: number
  slots: number
  stones: number
  stonesLevel: number
  engraves: number
}
export type RingsInput = {
  grade: number
  targetGrade: number
  stock?: Record<RingMaterial, number>
  prices?: Record<RingMaterial, number>
  silverStock?: number
  enhancement?: RingEnhancementInput
}
export type RingsResult = {
  materialsNeeded: number
  polarRings: number
  quartz: number
  emeralds: number
  rubies: number
  topaz: number
  temperedAmethyst: number
  silver: number
  silverNeeded: number
  missing: Record<RingMaterial, number>
  totalCost: number
  enhancement: {
    refine: number
    slots: number
    stones: number
    engraves: number
  }
}
export type RobeYarn =
  'cloudYarn' | 'heavenlyYarn' | 'solarYarn' | 'moonYarn' | 'starYarn'
export type RobeInput = {
  grade: number
  targetGrade: number
  source: 'scratch' | 'ascension'
  yarnMethod?: 'hourglass' | 'arigora'
  silverStock: number
  stock: Record<RobeYarn, number>
  prices: Record<RobeYarn, number>
  hourglassStock?: number
  sundialStock?: number
  hourglassPerWeek?: number
  sundialPerWeek?: number
  arigoraStock?: number
}
export type RobeResult = {
  materialsNeeded: number
  required: Record<RobeYarn, number>
  missing: Record<RobeYarn, number>
  silverNeeded: number
  totalCost: number
  hourglassNeeded: number
  sundialNeeded: number
  arigoraNeeded: number
  farmWeeks: number | null
  steps: Array<{
    targetGrade: number
    required: Record<RobeYarn, number>
    silver: number
  }>
}
export type EquipmentInput = {
  slot: string
  grade: string
  targetGrade: string
  xx1Path?: 'xx1' | 'r8'
  xx3Path?: 'xx3' | 'rent'
  count: number
  stock?: Record<string, number>
  prices?: Record<string, number>
}
export type EquipmentResult = {
  materialsNeeded: number
  required: Record<string, number>
  missing: Record<string, number>
  silverNeeded: number
  totalCost: number
  supported: boolean
}
export type EquipmentItemInput = Omit<
  EquipmentInput,
  'count' | 'stock' | 'prices'
> & { count: number }
export type NightWeaponInput = {
  grade: number
  targetGrade: number
  baseScales: number
  temperedScales: number
  charms: number
  baseScalePrice: number
  charmPrice: number
  silver: number
  money: number
  goldPrice: number
  donateType: 0 | 30 | 40
  mausoleum: boolean
  mausoleumDouble: boolean
  chestDays: number
  clanScalesPerWeek: number
  twins: number
}
export type NightWeaponResult = {
  scalesNeeded: number
  temperedScalesNeeded: number
  charmsNeeded: number
  silverNeeded: number
  cost: number
  gold: number
  rubles: number
  farmDays: number | null
}
export type ChienkunInput = {
  level: number
  quantity?: number
  purchasePrice?: number
  goldPrice?: number
}
export type ChienkunResult = {
  stonesNeeded: number
  goldNormal: number
  goldSale: number
  rublesNormal: number
  rublesSale: number
  yuanMarket: number
  yuanNormalGold: number
  yuanSaleGold: number
}
export type { TitlesInput, TitlesEstimate, TitleStat } from './titles.ts'
export { calculateTitleStats, estimateTitles } from './titles.ts'
const nonNegative = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)
export function calculateGods(input: GodsInput): GodsResult {
  const totalExperience = input.gods.reduce((sum, god) => {
    let required = 0
    for (
      let level = Math.floor(nonNegative(god.level)) + 1;
      level <= Math.floor(nonNegative(god.targetLevel));
      level++
    ) {
      required += GOD_LEVEL_EXPERIENCE[level] ?? 0
    }
    return sum + required
  }, 0)
  const silverNeeded = Math.max(0, totalExperience - nonNegative(input.silver))
  const rankEnergy = [0, 9, 90, 900, 1000, 2000, 4000, 8000, 16000, 32000, 0]
  const rankEnergyNeeded = input.gods.reduce((sum, god) => {
    const start = Math.min(10, Math.floor(nonNegative(god.rank)))
    const target = Math.min(10, Math.floor(nonNegative(god.targetRank)))
    let required = 0
    for (let rank = start; rank < target; rank++) {
      required += rankEnergy[rank] ?? 0
    }
    return sum + Math.max(0, required - nonNegative(god.energy))
  }, 0)
  const availableEnergy =
    nonNegative(input.experience) +
    1000 * nonNegative(input.chips) +
    1000 * nonNegative(input.highStones) +
    17.8 * nonNegative(input.stones)
  const energyNeeded =
    Math.max(0, rankEnergyNeeded - availableEnergy) *
    (1 + Math.min(100, nonNegative(input.failureChance)) / 100)
  const usesHighStones = input.stoneType === 'high'
  const stoneQuantity = Math.ceil(energyNeeded / (usesHighStones ? 1000 : 17.8))
  const stoneCost =
    stoneQuantity *
    nonNegative(usesHighStones ? input.highStonePrice : input.stonePrice)
  const gold =
    input.goldPrice > 0
      ? Math.floor(((silverNeeded + stoneCost) / input.goldPrice) * 1.02)
      : 0
  const donationRate =
    input.donateType === 30 ? 17.384 : input.donateType === 40 ? 18.922 : 0
  const baseRubles = Math.floor(13.38 * gold)
  const rubles = donationRate ? (baseRubles / donationRate) * 13.38 : baseRubles
  return {
    levelSilverCost: totalExperience,
    silverNeeded,
    energyNeeded,
    stoneQuantity,
    stoneCost,
    gold,
    rubles,
  }
}
const RING_RECIPES = [
  {
    polarRings: 1,
    quartz: 25,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 0,
    silver: 10_000_000,
  },
  {
    polarRings: 0,
    quartz: 375,
    emeralds: 50,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 0,
    silver: 20_000_000,
  },
  {
    polarRings: 0,
    quartz: 750,
    emeralds: 100,
    rubies: 15,
    topaz: 0,
    temperedAmethyst: 0,
    silver: 50_000_000,
  },
  {
    polarRings: 0,
    quartz: 1125,
    emeralds: 150,
    rubies: 25,
    topaz: 6,
    temperedAmethyst: 0,
    silver: 80_000_000,
  },
  {
    polarRings: 0,
    quartz: 0,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 15,
    silver: 100_000_000,
  },
  {
    polarRings: 0,
    quartz: 0,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 23,
    silver: 120_000_000,
  },
]
// Source recipe tables, indexed by resulting ring grade (1–6).
const RING_ENHANCEMENT = [
  {
    refine: [0, 0, 0, 1, 2, 4, 7, 13, 24, 30, 55, 100],
    slots: [0, 0, 1, 1],
    stones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 5, 12],
    engraves: [3, 23, 90],
  },
  {
    refine: [0, 0, 1, 2, 4, 7, 13, 26, 48, 59, 110, 200],
    slots: [0, 0, 1, 2],
    stones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 10, 24],
    engraves: [4, 30, 120],
  },
  {
    refine: [0, 0, 1, 2, 4, 7, 13, 26, 48, 59, 110, 200],
    slots: [0, 0, 1, 2],
    stones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 10, 24],
    engraves: [4, 30, 120],
  },
  {
    refine: [0, 0, 1, 2, 6, 11, 20, 38, 72, 89, 165, 300],
    slots: [0, 1, 2, 3],
    stones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 15, 36],
    engraves: [4, 30, 120],
  },
  {
    refine: [1, 1, 2, 4, 10, 18, 34, 64, 120, 149, 275, 500],
    slots: [1, 1, 3, 5],
    stones: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 5, 10, 25, 60],
    engraves: [5, 38, 150],
  },
  {
    refine: [1, 1, 2, 4, 10, 18, 34, 64, 120, 149, 275, 500],
    slots: [1, 1, 3, 5],
    stones: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 5, 10, 25, 60],
    engraves: [5, 38, 150],
  },
]
export function calculateRings(input: RingsInput): RingsResult {
  const result = {
    polarRings: 0,
    quartz: 0,
    emeralds: 0,
    rubies: 0,
    topaz: 0,
    temperedAmethyst: 0,
    silver: 0,
  }
  for (
    let grade = Math.max(0, Math.floor(nonNegative(input.grade)));
    grade < Math.min(6, Math.floor(nonNegative(input.targetGrade)));
    grade++
  ) {
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      result[key] += RING_RECIPES[grade]![key]
    }
  }
  const enhancement = { refine: 0, slots: 0, stones: 0, engraves: 0 }
  if (input.enhancement) {
    const e = input.enhancement
    for (
      let grade = Math.max(0, Math.floor(nonNegative(input.grade)));
      grade < Math.min(6, Math.floor(nonNegative(input.targetGrade)));
      grade++
    ) {
      const table = RING_ENHANCEMENT[grade]!
      enhancement.refine +=
        table.refine[Math.min(11, Math.floor(nonNegative(e.refine)) - 1)] ?? 0
      enhancement.slots +=
        table.slots[Math.min(3, Math.floor(nonNegative(e.slots)) - 1)] ?? 0
      enhancement.stones +=
        (table.stones[
          Math.min(13, Math.floor(nonNegative(e.stonesLevel)) - 1)
        ] ?? 0) * Math.floor(nonNegative(e.stones))
      enhancement.engraves +=
        table.engraves[Math.min(2, Math.floor(nonNegative(e.engraves)) - 1)] ??
        0
    }
  }
  return {
    materialsNeeded: Object.keys(result)
      .filter((key) => key !== 'silver')
      .reduce(
        (sum, key) =>
          sum +
          Math.max(
            0,
            result[key as keyof typeof result] -
              nonNegative(input.stock?.[key as RingMaterial] ?? 0),
          ),
        0,
      ),
    ...result,
    silverNeeded: Math.max(
      0,
      result.silver - nonNegative(input.silverStock ?? 0),
    ),
    missing: Object.fromEntries(
      Object.keys(result).map((key) => [
        key,
        Math.max(
          0,
          result[key as keyof typeof result] -
            nonNegative(input.stock?.[key as RingMaterial] ?? 0),
        ),
      ]),
    ) as Record<RingMaterial, number>,
    totalCost:
      Math.max(0, result.silver - nonNegative(input.silverStock ?? 0)) +
      (Object.keys(result) as RingMaterial[]).reduce(
        (sum, key) =>
          sum +
          Math.max(0, result[key] - nonNegative(input.stock?.[key] ?? 0)) *
            nonNegative(input.prices?.[key] ?? 0),
        0,
      ),
    enhancement,
  }
}
const ROBE_RECIPES = {
  scratch: [
    {
      cloudYarn: 100,
      heavenlyYarn: 0,
      solarYarn: 0,
      moonYarn: 0,
      starYarn: 0,
      silver: 5_000_000,
    },
    {
      cloudYarn: 500,
      heavenlyYarn: 150,
      solarYarn: 0,
      moonYarn: 0,
      starYarn: 0,
      silver: 10_000_000,
    },
    {
      cloudYarn: 1000,
      heavenlyYarn: 275,
      solarYarn: 50,
      moonYarn: 0,
      starYarn: 0,
      silver: 20_000_000,
    },
    {
      cloudYarn: 2000,
      heavenlyYarn: 450,
      solarYarn: 80,
      moonYarn: 15,
      starYarn: 0,
      silver: 50_000_000,
    },
    {
      cloudYarn: 4500,
      heavenlyYarn: 675,
      solarYarn: 150,
      moonYarn: 25,
      starYarn: 6,
      silver: 80_000_000,
    },
  ],
  ascension: [
    {
      cloudYarn: 750,
      heavenlyYarn: 200,
      solarYarn: 30,
      moonYarn: 0,
      starYarn: 0,
      silver: 20_000_000,
    },
    {
      cloudYarn: 2000,
      heavenlyYarn: 450,
      solarYarn: 80,
      moonYarn: 15,
      starYarn: 0,
      silver: 50_000_000,
    },
    {
      cloudYarn: 4500,
      heavenlyYarn: 675,
      solarYarn: 150,
      moonYarn: 25,
      starYarn: 6,
      silver: 80_000_000,
    },
  ],
} as const
const ROBE_YARNS: readonly RobeYarn[] = [
  'cloudYarn',
  'heavenlyYarn',
  'solarYarn',
  'moonYarn',
  'starYarn',
]
export function calculateRobe(input: RobeInput): RobeResult {
  const required = Object.fromEntries(
    ROBE_YARNS.map((yarn) => [yarn, 0]),
  ) as Record<RobeYarn, number>
  let silver = 0
  const steps: RobeResult['steps'] = []
  const grade = Math.floor(nonNegative(input.grade))
  const target = Math.floor(nonNegative(input.targetGrade))
  const offset = input.source === 'ascension' ? 2 : 0
  const start = Math.max(0, grade - offset)
  const finish = Math.min(
    ROBE_RECIPES[input.source].length,
    Math.max(0, target - offset),
  )
  for (let index = start; index < finish; index++) {
    const recipe = ROBE_RECIPES[input.source][index]
    if (!recipe) {
      continue
    }
    steps.push({
      targetGrade: index + offset + 1,
      required: Object.fromEntries(
        ROBE_YARNS.map((yarn) => [yarn, recipe[yarn]]),
      ) as Record<RobeYarn, number>,
      silver: recipe.silver,
    })
    for (const yarn of ROBE_YARNS) {
      required[yarn] += recipe[yarn]
    }
    silver += recipe.silver
  }
  const missing = Object.fromEntries(
    ROBE_YARNS.map((yarn) => [
      yarn,
      Math.max(0, required[yarn] - nonNegative(input.stock[yarn])),
    ]),
  ) as Record<RobeYarn, number>
  const materialsNeeded = ROBE_YARNS.reduce(
    (sum, yarn) => sum + missing[yarn],
    0,
  )
  const silverNeeded = Math.max(0, silver - nonNegative(input.silverStock))
  const materialsCost = ROBE_YARNS.reduce(
    (sum, yarn) => sum + missing[yarn] * nonNegative(input.prices[yarn]),
    0,
  )
  const yarnMethod = input.yarnMethod ?? 'hourglass'
  const timeRecipes: Record<
    RobeYarn,
    { hourglass: number; sundial: number; arigora: number }
  > = {
    cloudYarn: { hourglass: 1, sundial: 0, arigora: 2 },
    heavenlyYarn: { hourglass: 10, sundial: 0, arigora: 20 },
    solarYarn: { hourglass: 75, sundial: 0, arigora: 150 },
    moonYarn: { hourglass: 500, sundial: 5, arigora: 1000 },
    starYarn: { hourglass: 2500, sundial: 20, arigora: 5000 },
  }
  const rawHourglass = ROBE_YARNS.reduce(
    (sum, yarn) => sum + missing[yarn] * timeRecipes[yarn].hourglass,
    0,
  )
  const rawSundial = ROBE_YARNS.reduce(
    (sum, yarn) => sum + missing[yarn] * timeRecipes[yarn].sundial,
    0,
  )
  const hourglassNeeded =
    yarnMethod === 'hourglass'
      ? Math.max(0, rawHourglass - nonNegative(input.hourglassStock ?? 0))
      : 0
  const sundialNeeded =
    yarnMethod === 'hourglass'
      ? Math.max(0, rawSundial - nonNegative(input.sundialStock ?? 0))
      : 0
  const arigoraNeeded =
    yarnMethod === 'arigora'
      ? Math.max(
          0,
          ROBE_YARNS.reduce(
            (sum, yarn) => sum + missing[yarn] * timeRecipes[yarn].arigora,
            0,
          ) - nonNegative(input.arigoraStock ?? 0),
        )
      : 0
  const weeksForHourglass =
    hourglassNeeded > 0
      ? nonNegative(input.hourglassPerWeek ?? 0) > 0
        ? Math.ceil(hourglassNeeded / nonNegative(input.hourglassPerWeek!))
        : null
      : 0
  const weeksForSundial =
    sundialNeeded > 0
      ? nonNegative(input.sundialPerWeek ?? 0) > 0
        ? Math.ceil(sundialNeeded / nonNegative(input.sundialPerWeek!))
        : null
      : 0
  const farmWeeks =
    weeksForHourglass === null || weeksForSundial === null
      ? null
      : Math.max(weeksForHourglass, weeksForSundial)
  return {
    materialsNeeded,
    required,
    missing,
    silverNeeded,
    totalCost: silverNeeded + materialsCost,
    hourglassNeeded,
    sundialNeeded,
    arigoraNeeded,
    farmWeeks,
    steps,
  }
}
const EQUIPMENT_RECIPES: Record<
  string,
  Record<string, Record<string, Record<string, number>>>
> = {
  armor: {
    none: {
      r8: { silver: 1_000_000 },
      xx1: {
        silver: 1_000_000,
        'Печатка Сумерек': 320,
        Хрономатериал: 100,
        'Зола мира грез': 180,
        'Смерть древнего демона': 20,
      },
    },
    r8: { r8r: { silver: 10_000_000, 'Исток светил': 200 } },
    r8r: { r8r2: { silver: 20_000_000, 'Свиток дракона': 3 } },
    r8r2: {
      r9r2: { silver: 20_000_000, 'Печать дракона': 9 },
      xx1: {
        silver: 1_000_000,
        'Печатка Сумерек': 48,
        Хрономатериал: 50,
        'Зола мира грез': 27,
        'Смерть древнего демона': 3,
      },
    },
    xx1: {
      xx2: {
        silver: 1_000_000,
        'Печатка Сумерек': 400,
        'Колесо Судьбы': 10,
        'Зола мира грез': 200,
        'Смерть древнего демона': 20,
      },
    },
    xx2: {
      xx3: {
        silver: 1_000_000,
        'Печатка Сумерек': 800,
        'Колесо Судьбы': 10,
        'Опал Лунной кошки': 10,
        'Зола мира грез': 400,
        'Смерть древнего демона': 40,
        "Плащ 'Королевские крылья'": 320,
        'Верное сердце Элмсли': 35,
      },
      xx3rent: {
        silver: 0,
        'Печатка Сумерек': 240,
        'Колесо Судьбы': 3,
        'Опал Лунной кошки': 3,
        'Зола мира грез': 120,
        'Смерть древнего демона': 12,
        "Плащ 'Королевские крылья'": 96,
        'Верное сердце Элмсли': 14,
        gold: 45,
      },
    },
    r9r2: {
      xx3: {
        silver: 1_000_000,
        'Печатка Сумерек': 800,
        'Колесо Судьбы': 10,
        'Опал Лунной кошки': 10,
        'Зола мира грез': 400,
        'Смерть древнего демона': 40,
        "Плащ 'Королевские крылья'": 320,
        'Верное сердце Элмсли': 35,
      },
      xx3rent: {
        silver: 0,
        'Печатка Сумерек': 240,
        'Колесо Судьбы': 3,
        'Опал Лунной кошки': 3,
        'Зола мира грез': 120,
        'Смерть древнего демона': 12,
        "Плащ 'Королевские крылья'": 96,
        'Верное сердце Элмсли': 14,
        gold: 45,
      },
    },
    xx3: {
      ts1: {
        silver: 10_000_000,
        'Зеркало десяти сторон': 1800,
        'Печать Цинцю': 1800,
        'Перо короля фениксов': 1800,
        'Кость летучей змеи': 1800,
        'Печать равнодушия': 1800,
        'Закаленные перья перерождений': 72,
        "Нефрит 'Грезы лисицы'": 720,
      },
      xx3payment: {
        silver: 0,
        'Печатка Сумерек': 80,
        'Колесо Судьбы': 1,
        'Опал Лунной кошки': 1,
        'Зола мира грез': 40,
        'Смерть древнего демона': 4,
        "Плащ 'Королевские крылья'": 32,
        'Верное сердце Элмсли': 3,
        gold: 15,
      },
    },
    ts1: {
      ts2: {
        silver: 10_000_000,
        'Зеркало десяти сторон': 2700,
        'Печать Цинцю': 2700,
        'Перо короля фениксов': 2700,
        'Кость летучей змеи': 2700,
        'Печать равнодушия': 2700,
        'Закаленные перья перерождений': 108,
        "Нефрит 'Грезы лисицы'": 1080,
      },
    },
  },
  pants: {},
  boots: {},
  bracers: {},
}
// Slot recipes share most transitions; material families differ on ХХ1–ХХ3.
for (const [slot, source] of Object.entries({
  pants: [
    'Лезвие демона',
    'Ложь Владычицы грез',
    'Боевой дух Элмсли',
    'Королевский лук',
    'Вода трех тысяч озер',
  ],
  boots: [
    'Королевская слава',
    'Маска Цзи Чжунь',
    'Поцелуй владычицы',
    'Королевский посох',
    'Пламя короля фениксов',
  ],
  bracers: [
    'Коварство министра',
    'Горе династии',
    "Плащ 'Королевские крылья'",
    'Свет Хуанлинь',
    'Прах времени',
  ],
} as Record<string, string[]>)) {
  const armor = EQUIPMENT_RECIPES.armor!
  const clone = structuredClone(armor)
  const [xx1Base, xx1Rare, xx3Material, xx3Part, tsMat] = source!
  const map: Record<string, string> = {
    'Зола мира грез': xx1Base!,
    'Смерть древнего демона': xx1Rare!,
    "Нефрит 'Грезы лисицы'": tsMat!,
  }
  if (slot === 'pants') {
    map["Плащ 'Королевские крылья'"] = xx3Material!
    map['Верное сердце Элмсли'] = xx3Part!
  }
  if (slot === 'boots') {
    map['Королевская слава'] = xx1Base!
    map['Маска Цзи Чжунь'] = xx1Rare!
    map['Поцелуй владычицы'] = xx3Material!
    map['Королевский посох'] = xx3Part!
  }
  if (slot === 'bracers') {
    map['Коварство министра'] = xx1Base!
    map['Горе династии'] = xx1Rare!
    map["Плащ 'Королевские крылья'"] = xx3Material!
    map['Свет Хуанлинь'] = xx3Part!
  }
  for (const destinations of Object.values(clone)) {
    for (const recipe of Object.values(destinations)) {
      for (const [oldKey, newKey] of Object.entries(map)) {
        if (oldKey !== newKey && recipe[oldKey] !== undefined) {
          recipe[newKey] = recipe[oldKey]!
          delete recipe[oldKey]
        }
      }
    }
  }
  EQUIPMENT_RECIPES[slot] = clone
}
function equipmentPath(input: EquipmentInput): Record<string, number>[] | null {
  const recipes = EQUIPMENT_RECIPES[input.slot]
  if (!recipes) {
    return null
  }
  let at = input.grade
  const target = input.targetGrade
  if (at === target) {
    return []
  }
  const result: Record<string, number>[] = []
  const allowed: Record<string, string[]> = {
    none: input.xx1Path === 'xx1' ? ['xx1'] : ['r8'],
    r8: ['r8r'],
    r8r: ['r8r2'],
    r8r2: target === 'xx2' || target === 'xx1' ? ['xx1'] : ['r9r2'],
    r9r2: [input.xx3Path === 'rent' ? 'xx3rent' : 'xx3'],
    xx1: ['xx2'],
    xx2: [input.xx3Path === 'rent' ? 'xx3rent' : 'xx3'],
    xx3: [target === 'xx3payment' ? 'xx3payment' : 'ts1'],
    ts1: ['ts2'],
  }
  for (let steps = 0; steps < 12 && at !== target; steps++) {
    const next = allowed[at]?.[0]
    if (!next || !recipes[at]?.[next]) {
      return null
    }
    result.push(recipes[at]![next]!)
    at = next
  }
  return at === target ? result : null
}
export function calculateEquipment(input: EquipmentInput): EquipmentResult {
  const count = Math.floor(nonNegative(input.count))
  const path = equipmentPath(input)
  if (!path) {
    return {
      materialsNeeded: 0,
      required: {},
      missing: {},
      silverNeeded: 0,
      totalCost: 0,
      supported: false,
    }
  }
  const required: Record<string, number> = {}
  for (const recipe of path) {
    for (const [key, value] of Object.entries(recipe)) {
      required[key] = (required[key] ?? 0) + value * count
    }
  }
  const wheel = required['Колесо Судьбы'] ?? 0
  const opal = required['Опал Лунной кошки'] ?? 0
  const temperedFeathers = required['Закаленные перья перерождений'] ?? 0
  if (wheel) {
    delete required['Колесо Судьбы']
    required['Фрагмент Колеса Судьбы'] =
      (required['Фрагмент Колеса Судьбы'] ?? 0) + wheel * 10
    required['Хрономатериал'] = (required['Хрономатериал'] ?? 0) + wheel * 20
    required.silver = (required.silver ?? 0) + wheel * 1_000_000
  }
  if (opal) {
    delete required['Опал Лунной кошки']
    required['Фрагмент опала'] = opal * 10
    required['Хрономатериал'] = (required['Хрономатериал'] ?? 0) + opal * 100
    required.silver = (required.silver ?? 0) + opal * 1_000_000
  }
  if (temperedFeathers) {
    delete required['Закаленные перья перерождений']
    required['Перья перерождений'] =
      (required['Перья перерождений'] ?? 0) + temperedFeathers * 5
    required['Амулет пяти закалок'] =
      (required['Амулет пяти закалок'] ?? 0) + temperedFeathers
    required.silver = (required.silver ?? 0) + temperedFeathers * 5_000_000
  }
  const missing = Object.fromEntries(
    Object.entries(required).map(([key, value]) => [
      key,
      Math.max(0, value - nonNegative(input.stock?.[key] ?? 0)),
    ]),
  )
  return {
    materialsNeeded: Object.entries(missing)
      .filter(([key]) => key !== 'silver' && key !== 'gold')
      .reduce((sum, [, value]) => sum + value, 0),
    required,
    missing,
    silverNeeded: missing.silver ?? 0,
    totalCost: Object.entries(missing).reduce(
      (sum, [key, value]) =>
        sum + value * nonNegative(input.prices?.[key] ?? 0),
      0,
    ),
    supported: true,
  }
}
export function calculateEquipmentList(input: {
  items: readonly EquipmentItemInput[]
  stock?: Record<string, number>
  prices?: Record<string, number>
}): EquipmentResult {
  const required: Record<string, number> = {}
  let supported = true
  for (const item of input.items) {
    const result = calculateEquipment({ ...item, stock: {}, prices: {} })
    supported &&= result.supported
    for (const [key, quantity] of Object.entries(result.required)) {
      required[key] = (required[key] ?? 0) + quantity
    }
  }
  const missing = Object.fromEntries(
    Object.entries(required).map(([key, quantity]) => [
      key,
      Math.max(0, quantity - nonNegative(input.stock?.[key] ?? 0)),
    ]),
  )
  return {
    materialsNeeded: Object.entries(missing)
      .filter(([key]) => key !== 'silver' && key !== 'gold')
      .reduce((sum, [, quantity]) => sum + quantity, 0),
    required,
    missing,
    silverNeeded: missing.silver ?? 0,
    totalCost: Object.entries(missing).reduce(
      (sum, [key, quantity]) =>
        sum + quantity * nonNegative(input.prices?.[key] ?? 0),
      0,
    ),
    supported,
  }
}
export function calculateNightWeapon(
  input: NightWeaponInput,
): NightWeaponResult {
  const grade = Math.floor(nonNegative(input.grade))
  const targetGrade = Math.floor(nonNegative(input.targetGrade))
  const targetScales =
    targetGrade <= grade ? 0 : targetGrade === 1 ? 268 : grade === 1 ? 388 : 656
  const temperedScalesNeeded = Math.max(
    0,
    targetScales - nonNegative(input.temperedScales),
  )
  const rawScalesNeeded =
    (targetScales - nonNegative(input.temperedScales)) * 5 -
    nonNegative(input.baseScales)
  const scalesNeeded = Math.max(0, rawScalesNeeded)
  const rawCharmsNeeded =
    targetScales - nonNegative(input.temperedScales) - nonNegative(input.charms)
  const charmsNeeded = Math.max(0, rawCharmsNeeded)
  const baseCost = Math.max(
    0,
    rawScalesNeeded * nonNegative(input.baseScalePrice),
  )
  const charmCost = Math.max(0, rawCharmsNeeded * nonNegative(input.charmPrice))
  const silverCost =
    targetScales > 0 ? (targetGrade === 1 ? 200_000_000 : 240_000_000) : 0
  const silverNeeded = Math.max(
    0,
    5_000_000 * temperedScalesNeeded + silverCost - nonNegative(input.silver),
  )
  const moneyNeeded = Math.max(
    0,
    silverNeeded + baseCost + charmCost - nonNegative(input.money),
  )
  const gold =
    input.goldPrice > 0 ? Math.floor((moneyNeeded / input.goldPrice) * 1.02) : 0
  const donationRate =
    input.donateType === 30 ? 17.384 : input.donateType === 40 ? 18.922 : 0
  const baseRubles = Math.floor(13.38 * gold)
  const rubles = donationRate ? (baseRubles / donationRate) * 13.38 : baseRubles
  let dailyScales = 0
  if (input.mausoleum) {
    dailyScales += 4 / 3
  }
  if (input.mausoleumDouble) {
    dailyScales += 1
  }
  dailyScales =
    dailyScales * 0.205 +
    (5 / 30) * nonNegative(input.chestDays) +
    nonNegative(input.clanScalesPerWeek) / 7 +
    (7 / 3) * nonNegative(input.twins) * 0.1
  const farmDays =
    scalesNeeded <= 0
      ? 0
      : dailyScales > 0
        ? Math.ceil(scalesNeeded / dailyScales)
        : null
  return {
    scalesNeeded,
    temperedScalesNeeded,
    charmsNeeded,
    silverNeeded,
    cost: baseCost + charmCost,
    gold,
    rubles,
    farmDays,
  }
}
export function calculateChienkun(input: ChienkunInput): ChienkunResult {
  const level = Math.max(1, Math.min(12, Math.floor(nonNegative(input.level))))
  const stonesNeeded =
    ([0, 1, 5, 12, 28, 60, 80, 100, 150, 250, 400, 650, 1000][level] ?? 0) *
    Math.floor(nonNegative(input.quantity ?? 1))
  const goldNormal =
    Math.floor(stonesNeeded / 10) * 4.5 + (stonesNeeded % 10) * 0.5
  const goldSale =
    Math.floor(stonesNeeded / 10) * 3.15 + (stonesNeeded % 10) * 0.5
  const goldPrice = nonNegative(input.goldPrice ?? 0)
  return {
    stonesNeeded,
    goldNormal,
    goldSale,
    rublesNormal: Math.ceil(goldNormal * 13.38),
    rublesSale: Math.ceil(goldSale * 13.38),
    yuanMarket:
      (stonesNeeded * nonNegative(input.purchasePrice ?? 0)) / 1_000_000,
    yuanNormalGold: goldNormal * goldPrice * 1.02,
    yuanSaleGold: goldSale * goldPrice * 1.02,
  }
}
