import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RosterListResponse } from '../supabase/functions/_shared/contracts/roster'
import { CharacterStrengthRating } from '../src/features/home/character-strength-rating'
import { rosterKeys } from '../src/features/roster/query-keys'

const classLabels: Record<number, string> = {
  1: 'Оборотень',
  7: 'Маг',
  8: 'Воин',
}

const people: RosterListResponse = {
  truncated: false,
  items: [
    {
      id: 'member-1',
      gameNickname: 'ЛунныйКлык',
      classId: 1,
      className: classLabels[1]!,
      avatarUrl: null,
      role: 'member',
      pa: 125_500,
      pz: 42_000,
      bu: 7_500,
      hp: 63_200,
      bd: 9_800,
    },
    {
      id: 'member-2',
      gameNickname: 'ТихийВетер',
      classId: 7,
      className: classLabels[7]!,
      avatarUrl: null,
      role: 'officer',
      pa: 98_000,
      pz: 57_000,
      bu: 8_100,
      hp: 48_500,
      bd: 11_200,
    },
    {
      id: 'member-3',
      gameNickname: 'Клевер',
      classId: 8,
      className: classLabels[8]!,
      avatarUrl: null,
      role: 'member',
      pa: null,
      pz: null,
      bu: null,
      hp: null,
      bd: null,
    },
  ],
}

function Demo({ empty = false }: { empty?: boolean }) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000 } },
    })
    queryClient.setQueryData<RosterListResponse>(rosterKeys.list, {
      ...people,
      items: empty ? [] : people.items,
    })
    return queryClient
  })

  return (
    <QueryClientProvider client={client}>
      <CharacterStrengthRating />
    </QueryClientProvider>
  )
}

const meta = { title: 'Главная/Рейтинг силы' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Wide: Story = {
  name: 'Широкий экран',
  render: () => (
    <div className="w-full max-w-5xl">
      <Demo />
    </div>
  ),
}

export const Narrow: Story = {
  name: 'Узкий экран',
  render: () => (
    <div className="w-[360px] max-w-full">
      <Demo />
    </div>
  ),
}

export const Empty: Story = {
  name: 'Пустой рейтинг',
  render: () => (
    <div className="w-full max-w-5xl">
      <Demo empty />
    </div>
  ),
}
