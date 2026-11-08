import { API_ERRORS, type ApiErrorCode } from '../contracts/errors.ts'

// Без параметров-свойств конструктора: файл запускается и Node без сборки.
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly fields: Record<string, string> | undefined

  constructor(code: ApiErrorCode, fields?: Record<string, string>) {
    super(code)
    this.code = code
    this.status = API_ERRORS[code]
    this.fields = fields
  }
}
