import { MikroORM, ReflectMetadataProvider } from '@mikro-orm/core'
import { EmergencyEntity } from '@acildeprem/storage'
import { env } from '../environment'
// import { seedDatabase } from './helpers'

export async function mikroDB() {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    entities: [EmergencyEntity],
    clientUrl: env.postgres.url,
    pool: {
      min: 0,
      max: 10,
    },
    migrations: {
      disableForeignKeys: false,
    },
    schemaGenerator: {
      disableForeignKeys: false,
    },
    allowGlobalContext: true,
    // baseDir: __dirname, // defaults to `process.cwd()`
  })
  await orm.connect()

  console.log('Setting up the database...')
  const generator = orm.getSchemaGenerator()
  // remember to create database manually before launching the code
  await generator.dropSchema()
  await generator.createSchema()
  await generator.updateSchema()

  // await seedDatabase(orm.em)
}
