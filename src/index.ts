import '@abraham/reflection'

import path from 'path'
import { config } from 'dotenv'
import cors from '@fastify/cors'
import {
  createServer,
  registerShutdown,
} from '@acildeprem/service-common'
import { createRedisCache } from '@envelop/response-cache-redis'
import Redis from 'ioredis'

import { GraphQLError } from 'graphql'
import supertokens from 'supertokens-node'

import { errorHandler, plugin } from 'supertokens-node/framework/fastify/index.js'
import formDataPlugin from '@fastify/formbody'
import { S3Client } from '@aws-sdk/client-s3'

// import multipart from '@fastify/multipart'
import { type LogFn, type Logger, createRegistry } from '@acildeprem/api'
import { createStorage } from '@acildeprem/storage'

import { env } from './environment'
import { graphqlHandler } from './graphql-handler'
import { asyncStorage } from './async-storage'
import { useMikroORM } from './plugins/orm'
import { useRedis } from './plugins/redis'
import { AuthPlugin } from './auth'

const envd = process.env.NODE_ENV?.trim()?.toLowerCase() || 'development'

config({
  path: path.resolve(
    process.cwd(),
    `.env.${envd === 'test' ? 'development' : envd}`,
  ),
})

export async function main() {
  const redis = new Redis(env.redis.url)
  const cache = createRedisCache({ redis })

  const server = await createServer({
    name: 'graphql-api',
    tracing: false,
    log: {
      level: env.log.level,
    },
  })

  await useMikroORM(server)
  await useRedis(server)

  const storage = await createStorage(server.orm)

  // Auth plugin
  AuthPlugin(storage, server)

  registerShutdown({
    logger: server.log,
    async onShutdown() {
      await server.close()
      redis.disconnect()
      await storage.destroy()
    },
  })

  function createErrorHandler(_level: any): LogFn {
    return (error: any, errorLike?: any, ...args: any[]) => {
      server.log.error(error, errorLike, ...args)

      const errorObj
      = error instanceof Error ? error : errorLike instanceof Error ? errorLike : null

      if (errorObj instanceof GraphQLError)
        return

      if (errorObj instanceof Error) {
      // Sentry.captureException(errorObj, {
      //   level,
      //   extra: {
      //     error,
      //     errorLike,
      //     rest: args,
      //   },
      // })
      }
    }
  }

  server.setErrorHandler(errorHandler())

  const MOBILE = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3100'
    : 'https://acildeprem.com'

  const WEBSITE = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://acildeprem.com'

  const APP_ORIGIN_URLS = [
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'capacitor://',
    `capacitor://${MOBILE.split('://')[1]}`,
    `http://${MOBILE.split('://')[1]}`,
    `http://${WEBSITE.split('://')[1]}`,
    `https://${MOBILE.split('://')[1]}`,
    `https://${WEBSITE.split('://')[1]}`,
    /^http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,4}:\d{1,4}./,
  ]

  const ALLOWED_CORS_URLS = [
    ...APP_ORIGIN_URLS,
    'http://localhost:3001',
    'https://studio.apollographql.com',
  ]

  // server.addHook('preHandler', (req, res, done) => {
  //   console.log('preHandler', req.url)
  //   console.log('preHandler', req.headers)
  //   done()
  // })

  server.register(cors, {
    origin: ALLOWED_CORS_URLS,
    allowedHeaders: ['Content-Type', 'authorization', 'apollographql-client-version', 'X-Client', 'cookie', 'X-language', ...supertokens.getAllCORSHeaders()],
    credentials: true,
  })

  function getRequestId() {
    const store = asyncStorage.getStore()

    return store?.requestId
  }

  function wrapLogFn(fn: LogFn): LogFn {
    return (msg, ...args) => {
      const requestId = getRequestId()

      if (requestId)
        fn(`${msg} - (requestId=${requestId})`, ...args)

      else
        fn(msg, ...args)
    }
  }

  try {
    const errorHandler = createErrorHandler('error')
    const fatalHandler = createErrorHandler('fatal')

    function createGraphQLLogger(binds: Record<string, any> = {}): Logger {
      return {
        error: wrapLogFn(errorHandler),
        fatal: wrapLogFn(fatalHandler),
        info: wrapLogFn(server.log.info.bind(server.log)),
        warn: wrapLogFn(server.log.warn.bind(server.log)),
        trace: wrapLogFn(server.log.trace.bind(server.log)),
        debug: wrapLogFn(server.log.debug.bind(server.log)),
        child(bindings) {
          return createGraphQLLogger({
            ...binds,
            ...bindings,
            requestId: getRequestId(),
          })
        },
      }
    }

    const s3Client = new S3Client({
      endpoint: env.s3.endpoint,
      credentials: {
        accessKeyId: env.s3.credentials.accessKeyId,
        secretAccessKey: env.s3.credentials.secretAccessKey,
      },
      forcePathStyle: true,
      region: 'eu-west-1',
    })

    const graphqlLogger = createGraphQLLogger()

    const registry = createRegistry({
      logger: graphqlLogger,
      redis: {
        host: env.redis.host,
        port: env.redis.port,
        password: env.redis.password,
      },
      encryptionSecret: env.encryptionSecret,
      eventTarget: server.pubSub,
      orm: server.orm,
      storage,
      s3: {
        client: s3Client,
        bucketName: env.s3.bucketName,
      },
    })

    const graphqlPath = '/graphql'
    const port = env.http.port
    const signature = Math.random().toString(16).substr(2)

    const graphql = graphqlHandler({
      graphiqlEndpoint: graphqlPath,
      signature,
      cache,
      registry,
      supertokens: {
        connectionUri: env.supertokens.connectionURI,
        apiKey: env.supertokens.apiKey,
      },
      isProduction: env.environment === 'prod',
      release: env.release,
      logger: graphqlLogger as any,
      redis: server.redis,
      orm: server.orm,
      pubSub: server.pubSub,
    })

    server.route({
      method: ['GET', 'POST'],
      url: graphqlPath,
      handler: graphql,
    })

    // server all listen routes

    server.route({
      method: ['GET', 'HEAD'],
      url: '/_health',
      async handler(req, res) {
        res.status(200).send()
      },
    })

    server.route({
      method: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
      url: '/api/auth/redirect',
      async handler(req, res) {
        const REDIRECT_URL = 'http://localhost:3000'
        // @ts-expect-error
        if (req.query?.token) {
          // @ts-expect-error

          const redirectUrl = `${REDIRECT_URL}://auth/reset-password?token=${req.query.token}&rid=thirdpartyemailpassword`
          console.log(redirectUrl, 'redirectUrl')
          return res.redirect(redirectUrl)
        }
        // @ts-expect-error
        const code = req.query?.code ?? null
        console.log(code, 'AAAAA')
        // @ts-expect-error
        if (req.query?.provider && code) {
          // @ts-expect-error
          const redirectUrl = `${REDIRECT_URL}://auth/callback/${req.query.provider}?code=${code}`
          console.log(redirectUrl, 'redirectUrl')
          return res.redirect(redirectUrl)
        }

        return res.redirect(`${REDIRECT_URL}://`)
      },
    })

    await server.register(formDataPlugin)
    await server.register(plugin)

    // await server.register(multipart)
    server.addContentTypeParser('multipart/form-data', {}, (req, payload, done) =>
      done(null),
    )

    // server.addHook('preValidation', async (request: any, reply) => {
    //   if (!request.raw.isMultipart)
    //     return

    //   request.body = await processRequest(request.raw, reply.raw)
    // })

    await server.listen({
      port,
      host: '0.0.0.0',
    }).then(() => {
      server.log.info(`GraphQL API located at http://0.0.0.0:${port}/graphql`)
      console.log(server.printRoutes())
    })
      .catch(async (err) => {
        server.log.error(err)
        await server.close()
        throw err
      })

    const used = process.memoryUsage()
    for (const key in used)
      console.log(`${key} ${Math.round((used as any)[key] / 1024 / 1024 * 100) / 100} MB`)
  }
  catch (error) {
    server.log.fatal(error)
    // Sentry.captureException(error, {
    //   level: 'fatal',
    // })
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
