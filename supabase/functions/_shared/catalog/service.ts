import type { ClassesResponse } from '../contracts/catalog.ts'
import type { Db } from '../db/client.ts'
import { catalogRepository } from './repository.ts'

/** Справочник классов доступен всем, включая гостя (форма регистрации). */
export async function listClasses(db: Db): Promise<ClassesResponse> {
  return { classes: await catalogRepository.activeClasses(db) }
}
