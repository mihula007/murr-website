import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../src/components/ui/alert-dialog'
import { Avatar } from '../src/components/ui/avatar'
import { Button } from '../src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../src/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../src/components/ui/dropdown-menu'
import { NavBadge } from '../src/components/ui/nav-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../src/components/ui/sheet'
import { Skeleton } from '../src/components/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../src/components/ui/tabs'
import { Toaster, toast } from '../src/components/ui/toaster'

const meta = { title: 'Дизайн-система/Оболочка' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const narrow = { viewport: { value: 'mobile1', isRotated: false } }

function DialogsExample() {
  return (
    <div className="flex flex-wrap gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Открыть диалог</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Участники события</DialogTitle>
            <DialogDescription>
              Список обновится после ответа.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">Подтверждение</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Уйти без сохранения?</AlertDialogTitle>
          <AlertDialogDescription>
            Несохранённые изменения будут потеряны.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Остаться</AlertDialogCancel>
            <AlertDialogAction>Уйти</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MenuExample() {
  return (
    <div className="flex flex-wrap gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">Клан</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem aria-current="page">
            Ивенты
            <NavBadge count={3} />
          </DropdownMenuItem>
          <DropdownMenuItem>Голосование</DropdownMenuItem>
          <DropdownMenuItem>Состав</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary">Боковая панель</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Murr клан</SheetTitle>
          <SheetDescription>Разделы сайта</SheetDescription>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function MiscExample() {
  return (
    <div className="grid max-w-xl gap-6">
      <Tabs defaultValue="active">
        <TabsList aria-label="Фильтр событий">
          <TabsTrigger value="active">Актуальные</TabsTrigger>
          <TabsTrigger value="archive">Архив</TabsTrigger>
        </TabsList>
        <TabsContent value="active">Ближайшие события клана.</TabsContent>
        <TabsContent value="archive">Прошедшие события.</TabsContent>
      </Tabs>
      <div className="flex items-center gap-3">
        <Avatar name="Мурка" />
        <NavBadge count={7} />
        <NavBadge count={120} />
        <NavBadge dot count={5} />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20" />
      </div>
      <Button
        variant="secondary"
        onClick={() => toast('Изменения сохранены')}
        className="justify-self-start"
      >
        Показать уведомление
      </Button>
      <Toaster />
    </div>
  )
}

export const Dialogs: Story = { name: 'Диалоги', render: DialogsExample }
export const DialogsNarrow: Story = {
  name: 'Диалоги — узкий экран',
  render: DialogsExample,
  globals: narrow,
}
export const Menus: Story = { name: 'Меню и панель', render: MenuExample }
export const MenusNarrow: Story = {
  name: 'Меню и панель — узкий экран',
  render: MenuExample,
  globals: narrow,
}
export const Misc: Story = {
  name: 'Вкладки, аватары, счётчики',
  render: MiscExample,
}
export const MiscNarrow: Story = {
  name: 'Вкладки, аватары, счётчики — узкий экран',
  render: MiscExample,
  globals: narrow,
}

function AvatarsExample() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name="Мурка" size="sm" />
      <Avatar name="Барсик" size="md" />
      <Avatar name="рейна" size="lg" />
      <Avatar name="" size="md" />
    </div>
  )
}
export const Avatars: Story = {
  name: 'Аватар: размеры 40, 72 и 76 px',
  render: AvatarsExample,
}
