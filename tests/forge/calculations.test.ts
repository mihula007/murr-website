import { describe, expect, it } from 'vitest'
import {
  calculateGods,
  calculateRings,
  calculateRobe,
  calculateEquipment,
  calculateEquipmentList,
  calculateNightWeapon,
  calculateChienkun,
  estimateTitles,
  calculateTitleStats,
} from '../../shared/forge/calculations/index'

describe('forge calculators', () => {
  it('requires exactly the level-two experience threshold', () => {
    expect(
      calculateGods(godInput({ level: 1, targetLevel: 2 })).levelSilverCost,
    ).toBe(2650)
  })
  it('uses rank energy, held resources, and failure chance for god stones', () => {
    const result = calculateGods(godInput({ targetRank: 2, failureChance: 25 }))
    expect(result.energyNeeded).toBe(11.25)
    expect(result.stoneQuantity).toBe(1)
  })
  it('converts discounted donation rubles after the source integer rounding', () => {
    const input = {
      ...godInput({ targetRank: 2 }),
      stonePrice: 100,
      donateType: 30 as const,
    }
    expect(calculateGods(input).rubles).toBeCloseTo(1049.8343, 3)
  })
  it('counts the first ring recipe from no ring', () => {
    expect(calculateRings({ grade: 0, targetGrade: 1 })).toMatchObject({
      polarRings: 1,
      quartz: 25,
      silver: 10_000_000,
      materialsNeeded: 26,
      silverNeeded: 10_000_000,
    })
  })
  it('calculates ring refinement, slot, gem, and engraving materials by target grade', () => {
    expect(
      calculateRings({
        grade: 0,
        targetGrade: 1,
        enhancement: {
          refine: 12,
          slots: 4,
          stones: 2,
          stonesLevel: 14,
          engraves: 3,
        },
      }).enhancement,
    ).toEqual({ refine: 100, slots: 1, stones: 24, engraves: 90 })
  })
  it('subtracts ring resources already in inventory', () => {
    const result = calculateRings({
      grade: 0,
      targetGrade: 1,
      stock: {
        polarRings: 1,
        quartz: 25,
        emeralds: 0,
        rubies: 0,
        topaz: 0,
        temperedAmethyst: 0,
      },
      silverStock: 10_000_000,
    })
    expect(result.missing.quartz).toBe(0)
    expect(result.silverNeeded).toBe(0)
  })
  it('returns zero for unchanged robe grade', () => {
    expect(
      calculateRobe(robeInput({ grade: 1, targetGrade: 1 })).silverNeeded,
    ).toBe(0)
  })
  it('uses the public cloak recipe for the base grade', () => {
    expect(
      calculateRobe(robeInput({ grade: 0, targetGrade: 1 })).required,
    ).toMatchObject({ cloudYarn: 100 })
    expect(
      calculateRobe(robeInput({ grade: 0, targetGrade: 1 })).silverNeeded,
    ).toBe(5_000_000)
  })
  it('uses the ascension cloak path for the second grade', () => {
    expect(
      calculateRobe(
        robeInput({ grade: 2, targetGrade: 3, source: 'ascension' }),
      ).required,
    ).toMatchObject({ cloudYarn: 750, heavenlyYarn: 200, solarYarn: 30 })
  })
  it('calculates hourglass and sundial requirements and farm weeks for a robe grade', () => {
    expect(
      calculateRobe(
        robeInput({
          grade: 3,
          targetGrade: 4,
          hourglassPerWeek: 5_000,
          sundialPerWeek: 25,
        }),
      ),
    ).toMatchObject({
      hourglassNeeded: 20_000,
      sundialNeeded: 75,
      farmWeeks: 4,
    })
  })
  it('supports buying robe yarn with Arigora coins', () => {
    expect(
      calculateRobe(
        robeInput({ grade: 0, targetGrade: 1, yarnMethod: 'arigora' }),
      ).arigoraNeeded,
    ).toBe(200)
  })
  it('uses the exact armor upgrade path recipe and item quantity', () => {
    const result = calculateEquipment({
      slot: 'armor',
      grade: 'none',
      targetGrade: 'r8',
      count: 2,
    })
    expect(result).toMatchObject({ supported: true, silverNeeded: 2_000_000 })
  })
  it('expands wheel and opal crafting ingredients in the armor upgrade cost', () => {
    const result = calculateEquipment({
      slot: 'armor',
      grade: 'xx1',
      targetGrade: 'xx2',
      count: 1,
    })
    expect(result.required).toMatchObject({
      'Фрагмент Колеса Судьбы': 100,
      Хрономатериал: 200,
      silver: 11_000_000,
    })
    expect(result.required['Колесо Судьбы']).toBeUndefined()
  })
  it('turns each required moon cat opal into ten fragments', () => {
    const result = calculateEquipment({
      slot: 'armor',
      grade: 'xx2',
      targetGrade: 'xx3',
      count: 1,
    })
    expect(result.required).toMatchObject({
      'Фрагмент опала': 100,
      Хрономатериал: 1200,
      silver: 21_000_000,
    })
    expect(result.required['Опал Лунной кошки']).toBeUndefined()
  })
  it('uses each intermediate equipment recipe and expands tempered feathers', () => {
    const result = calculateEquipment({
      slot: 'armor',
      grade: 'r8r2',
      targetGrade: 'ts1',
      count: 1,
    })
    expect(result.required).toMatchObject({
      'Печать дракона': 9,
      'Перья перерождений': 360,
      'Амулет пяти закалок': 72,
      silver: 411_000_000,
    })
  })
  it('combines several equipment items before subtracting the shared inventory', () => {
    const result = calculateEquipmentList({
      items: [
        {
          slot: 'armor',
          grade: 'none',
          targetGrade: 'r8',
          count: 2,
          xx1Path: 'r8',
          xx3Path: 'xx3',
        },
        {
          slot: 'pants',
          grade: 'none',
          targetGrade: 'r8',
          count: 1,
          xx1Path: 'r8',
          xx3Path: 'xx3',
        },
      ],
      stock: { silver: 2_000_000 },
      prices: { silver: 1 },
    })
    expect(result.required.silver).toBe(3_000_000)
    expect(result.silverNeeded).toBe(1_000_000)
    expect(result.totalCost).toBe(1_000_000)
  })
  it('uses the selected equipment slot material family', () => {
    const result = calculateEquipment({
      slot: 'pants',
      grade: 'none',
      targetGrade: 'xx1',
      xx1Path: 'xx1',
      count: 1,
    })
    expect(result.required).toMatchObject({
      'Лезвие демона': 180,
      'Ложь Владычицы грез': 20,
    })
    expect(result.required['Зола мира грез']).toBeUndefined()
  })
  it('does not request weapon scales when no upgrade is needed', () => {
    expect(
      calculateNightWeapon(weaponInput({ grade: 1, targetGrade: 1 }))
        .scalesNeeded,
    ).toBe(0)
  })
  it('uses the 268 tempered scales and five base scales per first upgrade', () => {
    expect(
      calculateNightWeapon(weaponInput({ grade: 0, targetGrade: 1 }))
        .scalesNeeded,
    ).toBe(1340)
  })
  it('uses the exact Chienkun stone table and normal/sale gold prices', () => {
    expect(calculateChienkun({ level: 12 })).toMatchObject({
      stonesNeeded: 1000,
      goldNormal: 450,
      goldSale: 315,
    })
  })
  it('prices Chienkun stones in market yuan and gold with the source two-percent fee', () => {
    expect(
      calculateChienkun({ level: 11, purchasePrice: 2_000, goldPrice: 1_000 }),
    ).toMatchObject({
      stonesNeeded: 650,
      goldNormal: 292.5,
      goldSale: 204.75,
      yuanMarket: 1.3,
      yuanNormalGold: 298_350,
      yuanSaleGold: 208_845,
    })
  })
  it('requires zero fate stones when all titles are complete', () => {
    const checkedLevels = Object.fromEntries(
      [
        76112, 76113, 76379, 76380, 76533, 76534, 76910, 76911, 77517, 77518,
        77519, 77520, 77921, 77923, 78487, 78488, 78594, 78595, 78596, 78597,
        79290, 79291, 79292, 79293,
      ].map((id) => [id, 7]),
    )
    expect(estimateTitles({ checkedLevels }).average).toBe(0)
    expect(calculateTitleStats(checkedLevels)).toEqual([
      { stat: 'hp', current: 2400, maximum: 2400, remaining: 0 },
      { stat: 'pa', current: 24, maximum: 24, remaining: 0 },
      { stat: 'pz', current: 24, maximum: 24, remaining: 0 },
      { stat: 'patk', current: 1200, maximum: 1200, remaining: 0 },
      { stat: 'matk', current: 1200, maximum: 1200, remaining: 0 },
      { stat: 'pdef', current: 4800, maximum: 4800, remaining: 0 },
      { stat: 'mdef', current: 4800, maximum: 4800, remaining: 0 },
    ])
  })
  it('estimates title levels from pair probabilities', () => {
    const checkedLevels = Object.fromEntries(
      [
        76112, 76113, 76379, 76380, 76533, 76534, 76910, 76911, 77517, 77518,
        77519, 77520, 77921, 77923, 78487, 78488, 78594, 78595, 78596, 78597,
        79290, 79291, 79292, 79293,
      ].map((id) => [id, 0]),
    )
    const result = estimateTitles({ checkedLevels })
    expect(result.average).toBe(11_163)
    expect(result.average).toBeGreaterThan(0)
    expect(result.optimistic).toBeLessThan(result.average)
    expect(result.conservative).toBeGreaterThan(result.average)
  })
})

function godInput(
  overrides: Partial<{
    level: number
    targetLevel: number
    rank: number
    targetRank: number
    energy: number
    failureChance: number
    highStones: number
  }> = {},
) {
  return {
    gods: [
      {
        level: overrides.level ?? 1,
        targetLevel: overrides.targetLevel ?? 1,
        rank: overrides.rank ?? 1,
        targetRank: overrides.targetRank ?? 1,
        energy: overrides.energy ?? 0,
      },
    ],
    silver: 0,
    experience: 0,
    chips: 0,
    highStones: overrides.highStones ?? 0,
    stones: 0,
    stoneType: 'normal' as const,
    highStonePrice: 0,
    stonePrice: 0,
    goldPrice: 1,
    failureChance: overrides.failureChance ?? 0,
    donateType: 0 as const,
  }
}

function weaponInput(
  overrides: Partial<{ grade: number; targetGrade: number }> = {},
) {
  return {
    grade: overrides.grade ?? 0,
    targetGrade: overrides.targetGrade ?? 0,
    baseScales: 0,
    temperedScales: 0,
    charms: 0,
    baseScalePrice: 0,
    charmPrice: 0,
    silver: 0,
    money: 0,
    goldPrice: 0,
    donateType: 0 as const,
    mausoleum: false,
    mausoleumDouble: false,
    chestDays: 0,
    clanScalesPerWeek: 0,
    twins: 0,
  }
}

function robeInput(
  overrides: Partial<{
    grade: number
    targetGrade: number
    source: 'scratch' | 'ascension'
    yarnMethod: 'hourglass' | 'arigora'
    hourglassPerWeek: number
    sundialPerWeek: number
  }> = {},
) {
  return {
    grade: overrides.grade ?? 0,
    targetGrade: overrides.targetGrade ?? 0,
    source: overrides.source ?? ('scratch' as const),
    yarnMethod: overrides.yarnMethod ?? 'hourglass',
    hourglassPerWeek: overrides.hourglassPerWeek ?? 0,
    sundialPerWeek: overrides.sundialPerWeek ?? 0,
    silverStock: 0,
    stock: {
      cloudYarn: 0,
      heavenlyYarn: 0,
      solarYarn: 0,
      moonYarn: 0,
      starYarn: 0,
    },
    prices: {
      cloudYarn: 0,
      heavenlyYarn: 0,
      solarYarn: 0,
      moonYarn: 0,
      starYarn: 0,
    },
  }
}
