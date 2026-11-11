/** После неудачной отправки переводит фокус на первое поле с ошибкой. */
export function focusFirstInvalid() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus()
  })
}
