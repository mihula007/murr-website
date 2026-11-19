import { describe, expect, it } from 'vitest'
import { itemsInVirtualRow } from '@/components/virtual-list'

describe('responsive virtual grid rows', () => {
  it('groups items into two-column rows and keeps the final partial row', () => {
    const items = ['one', 'two', 'three', 'four', 'five']
    expect(itemsInVirtualRow(items, 0, 2)).toEqual(['one', 'two'])
    expect(itemsInVirtualRow(items, 1, 2)).toEqual(['three', 'four'])
    expect(itemsInVirtualRow(items, 2, 2)).toEqual(['five'])
  })

  it('keeps one-column phone rows and three-column desktop rows', () => {
    const items = ['one', 'two', 'three', 'four']
    expect(itemsInVirtualRow(items, 1, 1)).toEqual(['two'])
    expect(itemsInVirtualRow(items, 1, 3)).toEqual(['four'])
  })
})
