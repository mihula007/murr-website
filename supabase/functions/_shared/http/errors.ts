import { API_ERRORS, type ApiErrorCode } from '../contracts/errors.ts'

export class ApiError extends Error {
  readonly status: number

  constructor(
    readonly code: ApiErrorCode,
    readonly fields?: Record<string, string>,
  ) {
    super(code)
    this.status = API_ERRORS[code]
  }
}
