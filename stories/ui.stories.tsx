import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../src/components/ui/button'
import { Input, Textarea } from '../src/components/ui/input'
import { Select } from '../src/components/ui/select'
import { Badge, Card, Field, Notice } from '../src/components/ui/surfaces'

const meta = { title: 'Дизайн-система/Элементы' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Actions: Story = {
  name: 'Кнопки',
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Основное действие</Button>
      <Button variant="secondary">Дополнительное</Button>
      <Button variant="outline">Контурное</Button>
      <Button variant="ghost">Без фона</Button>
      <Button disabled>Недоступно</Button>
    </div>
  ),
}
export const Surfaces: Story = {
  name: 'Карточки и статусы',
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Card>
        <Badge>Событие</Badge>
        <h2 className="mt-3 text-xl font-bold">Встреча гильдии</h2>
        <p className="mt-2 text-muted-foreground">
          Карточка для содержимого и действий.
        </p>
        <Button className="mt-4" variant="secondary">
          Подробнее
        </Button>
      </Card>
      <Notice>Информация, на которую стоит обратить внимание.</Notice>
    </div>
  ),
}
export const Forms: Story = {
  name: 'Поля формы',
  render: () => (
    <div className="grid max-w-xl gap-4">
      <Field htmlFor="name">
        Имя
        <Input id="name" placeholder="Имя персонажа" />
      </Field>
      <Field htmlFor="class">
        Класс
        <Select
          id="class"
          placeholder="Выберите класс"
          options={[
            { value: 'warrior', label: 'Воин' },
            { value: 'mage', label: 'Маг' },
            { value: 'archer', label: 'Лучник' },
          ]}
        />
      </Field>
      <Field htmlFor="description">
        Описание
        <Textarea
          id="description"
          rows={4}
          placeholder="Расскажите подробнее"
        />
      </Field>
    </div>
  ),
}
export const Table: Story = {
  name: 'Таблица',
  render: () => (
    <Card className="max-w-2xl overflow-x-auto">
      <table className="guild-table">
        <thead>
          <tr>
            <th>Участник</th>
            <th>Класс</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Луна</td>
            <td>Маг</td>
            <td>
              <Badge>Участник</Badge>
            </td>
          </tr>
          <tr>
            <td>Ветер</td>
            <td>Воин</td>
            <td>
              <Badge>Участник</Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  ),
}
