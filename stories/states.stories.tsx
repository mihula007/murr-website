import type { Meta, StoryObj } from '@storybook/react-vite'
import { EmptyState } from '../src/components/states/empty-state'
import { ErrorState } from '../src/components/states/error-state'
import { ForbiddenState } from '../src/components/states/forbidden-state'
import { LoadingState } from '../src/components/states/loading-state'
import { PageHeader } from '../src/components/states/page-header'
import { RouteError } from '../src/components/states/route-error'
import { Button } from '../src/components/ui/button'
import { withRouter } from './router-decorator'

const meta = {
  title: 'Дизайн-система/Состояния страницы',
  decorators: [withRouter],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const narrow = { viewport: { value: 'mobile1', isRotated: false } }

function StatesExample() {
  return (
    <div className="grid max-w-3xl gap-8">
      <PageHeader
        title="Ивенты"
        description="Расписание событий и отметки участников."
        actions={<Button>Создать событие</Button>}
      />
      <LoadingState />
      <EmptyState
        title="Раздел в разработке"
        description="Содержимое появится на следующих этапах."
      />
      <ErrorState onRetry={() => undefined} />
    </div>
  )
}

export const States: Story = {
  name: 'Заголовок и состояния',
  render: StatesExample,
}
export const StatesNarrow: Story = {
  name: 'Заголовок и состояния — узкий экран',
  render: StatesExample,
  globals: narrow,
}
export const ForbiddenGuest: Story = {
  name: 'Нет доступа — гость',
  render: () => <ForbiddenState accessRole="guest" />,
}
export const ForbiddenReader: Story = {
  name: 'Нет доступа — чтец',
  render: () => <ForbiddenState accessRole="reader" />,
  globals: narrow,
}
export const RouteFailure: Story = {
  name: 'Ошибка маршрута',
  render: () => (
    <RouteError
      error={new Error('Пример ошибки маршрута')}
      reset={() => undefined}
    />
  ),
}
