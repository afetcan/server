import type { EntityManager } from '@mikro-orm/postgresql'
import { MikroORM } from '@mikro-orm/postgresql'
import waitOn from 'wait-on'
import fp from 'fastify-plugin'
import { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { createMikroORMPostgress } from '@afetcan/storage/createMikroORMPostgress'
import { env } from '../environment'
// import { entities } from '../entity/index'

// https://mikro-orm.io/docs/migrations/#importing-migrations-statically

// const distPath = process.env.NODE_ENV === 'production' ? 'build' : 'src'

// let migrationsList: MigrationObject[] | undefined

// if (process.env.NODE_ENV === 'production') {
//   const migrations = {}
//   function importAll(r: __WebpackModuleApi.RequireContext) {
//     r.keys().forEach(
//       key => (migrations[basename(key)] = Object.values(r(key))[0]),
//     )
//   }

//   importAll(require.context('../../migrations', false, /\.ts$/))

//   migrationsList = Object.keys(migrations).map(migrationName => ({
//     name: migrationName,
//     class: migrations[migrationName],
//   }))
// }

declare module 'fastify' {

  interface FastifyInstance {
    orm: MikroORM
    ormUser: MikroORM
  }

  interface FastifyRequest {
    em: EntityManager
  }
}

const plugin: FastifyPluginAsync = async (server) => {
  const logger = server.log.child({ plugin: 'orm' })

  logger.info('Wait for db connection.')

  // wait for db to be alive
  await waitOn({
    resources: [`tcp:${env.postgres.host}:${env.postgres.port}`],
    timeout: 30000,
  })

  logger.info('db is started. Connecting to it.')

  const dbConnection = await createMikroORMPostgress({
    env: true,
  })

  // in tests it can be handy to use those:
  // await schemaGenerator.refreshDatabase() // ensure db exists and is fresh
  // await schemaGenerator.clearDatabase() // removes all data

  server.decorateRequest('em', null)

  server.addHook('onRequest', async (req) => {
    req.em = dbConnection.em.fork() as EntityManager
  })

  server.decorate('orm', dbConnection)

  server.addHook('onClose', async () => {
    dbConnection.close()
  })
}

const ormPlugin = fp(plugin, {
  name: 'fastify-mikroorm',
})

export async function useMikroORM(server: FastifyInstance) {
  await server.register(ormPlugin)
}
