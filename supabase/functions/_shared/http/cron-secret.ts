/** Сравнивает секрет расписания без раннего выхода по первому несовпадению. */
export function isValidCronSecret(
  given: string | null,
  expected: string | null | undefined,
) {
  if (given === null || !expected) {
    return false
  }
  const actualBytes = new TextEncoder().encode(given)
  const expectedBytes = new TextEncoder().encode(expected)
  let diff = actualBytes.length ^ expectedBytes.length
  for (let index = 0; index < expectedBytes.length; index += 1) {
    diff |= (actualBytes[index] ?? 0) ^ expectedBytes[index]!
  }
  return diff === 0
}
