export type ClassCandidate = { name: string; line: number }
export type DesignSystemLike = {
  candidatesToCss(classes: string[]): (string | null)[]
}

export const STYLESHEET: string
export function findExtraStylesheets(paths: string[]): string[]
export function inspectStylesheet(css: string, file?: string): string[]
export function inspectComponentSource(
  source: string,
  file: string,
): { candidates: ClassCandidate[]; findings: string[] }
export function inspectCandidates(
  candidates: ClassCandidate[],
  file: string,
  designSystem: DesignSystemLike,
): string[]
