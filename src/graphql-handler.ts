import type {
  FastifyBaseLogger,
  FastifyRequest,
  RouteHandlerMethod,
} from 'fastify'
import { Plugin, createYoga, useErrorHandler } from 'graphql-yoga'
import { isGraphQLError } from '@envelop/core'
import {
  GraphQLError,
  ValidationContext,
  ValidationRule,
} from 'graphql'
import { ResolveAcceptLanguage } from 'resolve-accept-language'

import { createFetch } from '@whatwg-node/fetch'

import Session from 'supertokens-node/recipe/session/index.js'

import { useGraphQLModules } from '@envelop/graphql-modules'
import { useGenericAuth } from '@envelop/generic-auth'
import hyperid from 'hyperid'
import zod from 'zod'
import type { Application as Registry } from 'graphql-modules'
import { useResponseCache } from '@graphql-yoga/plugin-response-cache'
import type { Cache } from '@envelop/response-cache'
import { MikroORM } from '@mikro-orm/postgresql'
import { Redis } from 'ioredis'
import { Context, PubSub } from '@afetcan/api'
import { cleanRequestId } from '@afetcan/service-common'
import { asyncStorage } from './async-storage.js'

const reqIdGenerate = hyperid({ fixedLength: true })

const SuperTokenAccessTokenModel = zod.object({
  version: zod.literal('1'),
  superTokensUserId: zod.string(),
  /**
   * Supertokens for some reason omits externalUserId from the access token payload if it is null.
   */
  externalUserId: zod.optional(zod.union([zod.string(), zod.null()])),
  email: zod.string(),
  username: zod.string(),
})

export interface GraphQLHandlerOptions {
  graphiqlEndpoint: string
  signature: string
  registry: Registry
  supertokens: {
    connectionUri: string
    apiKey: string
  }
  isProduction: boolean
  cache: Cache
  redis: Redis
  release: string
  logger: FastifyBaseLogger
  orm: MikroORM
  pubSub: PubSub
}

export type SuperTokenSessionPayload = zod.TypeOf<typeof SuperTokenAccessTokenModel>

const NoIntrospection: ValidationRule = (context: ValidationContext) => ({
  Field(node) {
    if (node.name.value === '__schema' || node.name.value === '__type')
      context.reportError(new GraphQLError('GraphQL introspection is not allowed', [node]))
  },
})

function hasFastifyRequest(ctx: unknown): ctx is {
  req: FastifyRequest
} {
  return !!ctx && typeof ctx === 'object' && 'req' in ctx
}

function useNoIntrospection(params: {
  signature: string
  isNonProductionEnvironment: boolean
}): Plugin<{ req: FastifyRequest }> {
  return {
    onValidate({ context, addValidationRule }) {
      const isReadinessCheck = context.req.headers['x-signature'] === params.signature
      if (isReadinessCheck || params.isNonProductionEnvironment)
        return
      addValidationRule(NoIntrospection)
    },
  }
}

export const graphqlHandler = (options: GraphQLHandlerOptions): RouteHandlerMethod => {
  const server = createYoga<Context>({
    logging: options.logger,
    plugins: [
      useErrorHandler(({ errors, context }): void => {
        for (const error of errors) {
          // Only log unexpected errors.
          if (isGraphQLError(error))
            continue

          if (hasFastifyRequest(context))
            context.req.log.error(error)

          else
            server.logger.error(error)
        }
      }),
      useGenericAuth({
        mode: 'resolve-only',
        contextFieldName: 'session',
        resolveUserFn: async (ctx: Context) => {
          if (ctx.session)
            return ctx.session

          else
            return null
        },
      }),
      useGraphQLModules(options.registry),
      useNoIntrospection({
        signature: options.signature,
        isNonProductionEnvironment: options.isProduction === false,
      }),
      useResponseCache({
        // global cache
        ttl: 10,
        session: request => request.headers.get('session') || null,
        // session: () => null,
        ttlPerSchemaCoordinate: {
          'Query.libraries': process.env.NODE_ENV === 'production' ? 3600_000 : 3_000,
        },
        cache: options.cache,
      }),

    ],
    fetchAPI: createFetch({
      // We prefer `node-fetch` over `undici` and current unstable Node's implementation
      useNodeFetch: true,
      formDataLimits: {
        // Maximum allowed file size (in bytes)
        fileSize: 1024 * 1024 * 10,
        // Maximum allowed number of files
        files: 10,
        // Maximum allowed size of content (operations, variables etc...)
        fieldSize: 1024 * 1024 * 10,
        // Maximum allowed header size for form data
        headerSize: 1024 * 1024 * 10,
      },
    }),
    /*
    graphiql: request =>
      isNonProductionEnvironment ? { endpoint: request.headers.get('x-use-proxy') ?? request.url } : false,
    */
  })

  return async (req, reply) => {
    const requestIdHeader = req.headers['x-request-id'] ?? reqIdGenerate()
    const requestId = cleanRequestId(requestIdHeader)
    let session: SuperTokenSessionPayload | null = null

    const acceptLanguage = req.headers['accept-language']
    if (!acceptLanguage)
      return 'en-US;q=0.01,en-US;q=0.1,en-US;q=0.001'

    let locale = 'en-US'

    if (new ResolveAcceptLanguage(acceptLanguage, ['en-US']).hasMatch())
      locale = acceptLanguage

    try {
      const _session = await Session.getSession(req, reply)
      session = await verifySuperTokensSession(_session)
    }
    catch (error) {

    }
    req.headers.session = session ? session.superTokensUserId : ''
    await asyncStorage.run(
      {
        requestId,
      },
      async () => {
        const response = await server.handleNodeRequest(req, {
          req,
          reply,
          headers: req.headers,
          requestId,
          session,
          orm: req.em,
          redis: options.redis,
          pubSub: req.pubSub,
          locale,
        })

        response.headers.forEach((value, key) => {
          reply.header(key, value)
        })

        if (!reply.hasHeader('x-request-id'))
          reply.header('x-request-id', requestId || '')

        const accept = req.headers.accept

        if (!accept || accept === '*/*')
          reply.header('content-type', 'application/json')

        reply.status(response.status)
        reply.send(response.body)

        return reply
      },
    )
  }
}

/**
 * Verify whether a SuperTokens access token session is valid.
 * https://app.swaggerhub.com/apis/supertokens/CDI/2.15.1#/Session%20Recipe/verifySession
 */
async function verifySuperTokensSession(
  session: Session.SessionContainer,
): Promise<SuperTokenSessionPayload> {
  const sessionInfo = await session.getSessionData()
  return {
    ...sessionInfo,
    externalUserId: sessionInfo.externalUserId ?? null,
    username: sessionInfo.username ?? null,
  }
}
