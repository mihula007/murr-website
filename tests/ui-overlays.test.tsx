import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NavBadge } from '@/components/ui/nav-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

describe('AlertDialog', () => {
  it('закрывается по Escape и возвращает фокус на кнопку-триггер', async () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Удалить</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
          <AlertDialogDescription>Действие необратимо.</AlertDialogDescription>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    )
    const trigger = screen.getByRole('button', { name: 'Удалить' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Удалить запись?')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
  })
})

describe('Sheet', () => {
  it('закрывается по Escape', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Меню</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Навигация</SheetTitle>
          <SheetDescription>Разделы сайта</SheetDescription>
        </SheetContent>
      </Sheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }))
    const dialog = await screen.findByRole('dialog', { name: 'Навигация' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })
})

describe('DropdownMenu', () => {
  it('не блокирует прокрутку страницы при открытии', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Действия</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Изменить</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Действия' }), {
      key: 'Enter',
    })
    await screen.findByRole('menu')
    expect(document.body).not.toHaveAttribute('data-scroll-locked')
  })

  it('открывается с клавиатуры и перемещает фокус стрелками', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Клан</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>События</DropdownMenuItem>
          <DropdownMenuItem>Голосование</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const trigger = screen.getByRole('button', { name: 'Клан' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const menu = await screen.findByRole('menu')
    const items = screen.getAllByRole('menuitem')
    await waitFor(() =>
      expect(menu).toContainElement(document.activeElement as HTMLElement),
    )
    fireEvent.keyDown(document.activeElement ?? menu, { key: 'ArrowDown' })
    await waitFor(() => expect(items).toContain(document.activeElement))
  })
})

describe('NavBadge', () => {
  it('не рендерится при 0 и без значения', () => {
    const { container, rerender } = render(<NavBadge count={0} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<NavBadge />)
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает 99+ для больших значений', () => {
    render(<NavBadge count={150} />)
    expect(screen.getByText('99+')).toHaveAccessibleName('150 новых записей')
  })
})

describe('Avatar', () => {
  it('показывает инициал без изображения', () => {
    render(<Avatar name="мурка" />)
    expect(screen.getByText('М')).toBeInTheDocument()
    expect(screen.getByText('мурка')).toHaveClass('sr-only')
  })
})
