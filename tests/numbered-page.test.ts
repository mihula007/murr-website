import { describe, expect, it } from 'vitest'
import { NUMBERED_PAGE_SIZE } from '@contracts/paging'
import {
  numberedPage,
  pageWindow,
} from '../supabase/functions/_shared/http/numbered-page'

describe('numbered pages (Q-55)', () => {
  it('turns a page number into offset and limit', () => {
    expect(pageWindow(1)).toEqual({ offset: 0, limit: NUMBERED_PAGE_SIZE })
    expect(pageWindow(3)).toEqual({ offset: 100, limit: NUMBERED_PAGE_SIZE })
  })

  it('counts pages and keeps at least one page', () => {
    expect(numberedPage([], 0, 1)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
    })
    expect(numberedPage([], 101, 9).pageCount).toBe(3)
    expect(numberedPage([], 100, 2).pageCount).toBe(2)
  })
})
