import archer from '@/assets/roster-backgrounds/archer-v1.webp'
import assassin from '@/assets/roster-backgrounds/assassin-v1.webp'
import bard from '@/assets/roster-backgrounds/bard-v1.webp'
import bloodSpirit from '@/assets/roster-backgrounds/blood-spirit-v1.webp'
import druid from '@/assets/roster-backgrounds/druid-v1.webp'
import ghost from '@/assets/roster-backgrounds/ghost-v1.webp'
import guard from '@/assets/roster-backgrounds/guard-v1.webp'
import gunner from '@/assets/roster-backgrounds/gunner-v1.webp'
import mage from '@/assets/roster-backgrounds/mage-v1.webp'
import mystic from '@/assets/roster-backgrounds/mystic-v1.webp'
import paladin from '@/assets/roster-backgrounds/paladin-v1.webp'
import priest from '@/assets/roster-backgrounds/priest-v1.webp'
import reaper from '@/assets/roster-backgrounds/reaper-v1.webp'
import shaman from '@/assets/roster-backgrounds/shaman-v1.webp'
import wanderer from '@/assets/roster-backgrounds/wanderer-v1.webp'
import warrior from '@/assets/roster-backgrounds/warrior-v1.webp'
import werebeast from '@/assets/roster-backgrounds/werebeast-v1.webp'

/** Фиксированный фон карточек по ID класса из справочника character_classes. */
const backgrounds: Record<number, string> = {
  1: werebeast,
  2: druid,
  3: wanderer,
  4: priest,
  5: archer,
  6: paladin,
  7: mage,
  8: warrior,
  9: gunner,
  10: assassin,
  11: shaman,
  12: bard,
  13: mystic,
  14: guard,
  15: bloodSpirit,
  16: ghost,
  17: reaper,
}

export function rosterBackgroundForClass(classId: number) {
  return backgrounds[classId]
}
