import DataLoader from 'dataloader'
import { EntityManager } from '@mikro-orm/postgresql'
import { EmergencyEntity } from '@afetcan/storage'

export const getLibraries = (
  em: EntityManager,
) => {
  const loader = new DataLoader(async (keys: readonly string[]) => {
    console.log('!!!!!!!!!!! load drivers', keys)
    const rels = await em.find(EmergencyEntity, { id: { $in: keys as string[] } })
    console.log(rels, 'rel')
    const libMap = new Map(rels.map(lib => [lib.id, lib]))
    console.log(libMap, 'libMap')
    return keys.map(libId => libMap.get(libId))
  })
  console.log('!!!!!!!!!!! load drivers', loader)
  return loader
}
