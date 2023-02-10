import { createPubSub } from 'graphql-yoga'
import Redis from 'ioredis'
import { RedisClient } from 'ioredis/built/connectors/SentinelConnector/types'
import waitOn from 'wait-on'
import { createRedisEventTarget } from '@graphql-yoga/redis-event-target'
import fp from 'fastify-plugin'
import { PubSub } from '@acildeprem/api'
import { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { env } from '../environment.js'

declare module 'fastify' {

  interface FastifyInstance {
    redis: Redis
    pubSub: PubSub
  }

  interface FastifyRequest {
    redis: RedisClient
    pubSub: PubSub
  }
}

const plugin: FastifyPluginAsync = async (server) => {
  const logger = server.log.child({ plugin: 'redis' })

  logger.info('Wait for redis connection.')
  // wait for db to be alive
  await waitOn({
    resources: [`tcp:${env.redis.host}:${env.redis.port}`],
    timeout: 30000,
  })

  logger.info('redis is started. Connecting to it.')

  const redis = new Redis(env.redis.url)

  server.decorate('redis', redis)

  const publishClient = new Redis(env.redis.url, {
    retryStrategy(times) {
      return Math.min(times * 500, 2000)
    },
    reconnectOnError(error) {
      logger.warn('Redis reconnectOnError', error)
      return 1
    },
    db: 1,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
  const subscribeClient = new Redis(env.redis.url, {
    retryStrategy(times) {
      return Math.min(times * 500, 2000)
    },
    reconnectOnError(error) {
      logger.warn('Redis reconnectOnError', error)
      return 1
    },
    db: 1,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  const eventTarget = createRedisEventTarget({
    publishClient,
    subscribeClient,
  })

  const pubSub = createPubSub({ eventTarget })

  server.decorateRequest('pubSub', null)

  server.addHook('onRequest', async (req) => {
    req.pubSub = pubSub as PubSub
  })

  server.decorate('pubSub', pubSub)

  server.addHook('onClose', async () => {
    redis.disconnect()
  })
}

const redisPlugin = fp(plugin, {
  name: 'fastify-mikroorm',
})

export async function useRedis(server: FastifyInstance) {
  await server.register(redisPlugin)
}
