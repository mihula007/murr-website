import { z } from 'zod'
import {
  listMaterialsSchema,
  saveMaterialShape,
  type MaterialDetails,
  type MaterialListResponse,
} from './materials.ts'

/** Категории торговых объявлений (MKT-02). */
export const MARKET_CATEGORIES = [
  'sale',
  'buy',
  'trade',
  'service',
  'free',
] as const
export type MarketCategory = (typeof MARKET_CATEGORIES)[number]

export const MARKET_CATEGORY_LABELS: Record<MarketCategory, string> = {
  sale: 'Продажа',
  buy: 'Покупка',
  trade: 'Обмен',
  service: 'Услуги',
  free: 'Отдам даром',
}

export const listMarketSchema = listMaterialsSchema(MARKET_CATEGORIES)

/** Файлы к объявлениям запрещены (MKT-08): полей вложений нет. */
export const saveListingSchema = z.strictObject(
  saveMaterialShape(MARKET_CATEGORIES),
)
export type SaveListingInput = z.input<typeof saveListingSchema>

export type ListingDetails = MaterialDetails<MarketCategory>
export type MarketListResponse = MaterialListResponse<MarketCategory>
