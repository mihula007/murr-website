import type { Meta, StoryObj } from '@storybook/react-vite'
import UnsavedDemoPage from '../src/features/dev/unsaved-demo-page'
import { Toaster } from '../src/components/ui/toaster'
import { withRouter } from './router-decorator'

const meta = {
  title: 'Шаблоны/Несохранённые изменения',
  decorators: [withRouter],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function DemoExample() {
  return (
    <>
      <UnsavedDemoPage />
      <Toaster />
    </>
  )
}

/** Измените поле и нажмите «На главную»: появится подтверждение ухода. */
export const Demo: Story = { name: 'Демо-форма', render: DemoExample }
export const DemoNarrow: Story = {
  name: 'Демо-форма — узкий экран',
  render: DemoExample,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
