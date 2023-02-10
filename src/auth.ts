import Session from 'supertokens-node/recipe/session/index.js'
import ThirdPartyEmailPassword from 'supertokens-node/recipe/thirdpartyemailpassword/index.js'
import Dashboard from 'supertokens-node/recipe/dashboard/index.js'
import { TypeProvider } from 'supertokens-node/recipe/thirdparty/index.js'
import supertokens from 'supertokens-node'
import { Storage } from '@acildeprem/storage'
import { FastifyInstance } from 'fastify'
import { verifySession } from 'supertokens-node/recipe/session/framework/fastify/index.js'
import { SessionRequest } from 'supertokens-node/framework/fastify/index.js'
import { createTRPCProxyClient, httpLink } from '@trpc/client'
import { EmailsApi } from '@acildeprem/email'
import EmailVerification from 'supertokens-node/recipe/emailverification/index.js'
import { FastifyRequest } from 'supertokens-node/lib/build/framework/fastify/framework'
import { env } from './environment'

export const AuthPlugin = (storage: Storage, server: FastifyInstance) => {
  const { Github } = ThirdPartyEmailPassword

  const emailsService = createTRPCProxyClient<EmailsApi>({
    links: [
      httpLink({
        url: `${env.emailsEndpoint}/trpc`,
      }),
    ],
  })

  server.post('/updateinfo', {
    preHandler: verifySession(),
  }, async (req: SessionRequest, res) => {
    const session = req.session
    if (!session)
      throw new Error('Session not found')

    const dbUser = await storage.userRepo.getUserBySuperTokenId({ superTokensUserId: session.getUserId() })
    if (!dbUser) {
      throw new Error(
        'Creating a new session failed',
      )
    }

    await session.mergeIntoAccessTokenPayload(
      { username: dbUser.username },
    )
    res.send({ message: 'successfully updated access token payload' })
  })

  const providers: TypeProvider[] = []

  if (env.auth.github) {
    providers.push(Github({
      clientId: env.auth.github_secret.appId,
      clientSecret: env.auth.github_secret.privateKey,
    }))
  }

  return supertokens.init({
    framework: 'fastify',
    supertokens: {
      // https://try.supertokens.com is for demo purposes. Replace this with the address of your core instance (sign up on supertokens.com), or self host a core.
      connectionURI: env.supertokens.connectionURI,
      apiKey: env.supertokens.apiKey,
    },
    appInfo: {
      // learn more about this on https://supertokens.com/docs/session/appinfo
      appName: env.supertokens.appName,
      apiDomain: env.supertokens.apiDomain,
      websiteDomain: env.supertokens.websiteDomain,
      apiBasePath: '/auth',
      websiteBasePath: '/auth',
    },
    recipeList: [
      ThirdPartyEmailPassword.init({
        providers,
        override: {
          functions: (originalImplementation) => {
            return {
              ...originalImplementation,
              async emailPasswordSignUp(input) {
                const existingUsers = await ThirdPartyEmailPassword.getUsersByEmail(input.email)
                if (existingUsers.length === 0) {
                  // this means this email is new so we allow sign up
                  return originalImplementation.emailPasswordSignUp(input)
                }
                return {
                  status: 'EMAIL_ALREADY_EXISTS_ERROR',
                }
              },
              async thirdPartySignInUp(input) {
                const existingUsers = await ThirdPartyEmailPassword.getUsersByEmail(input.email)
                if (existingUsers.length === 0) {
                  // this means this email is new so we allow sign up
                  return originalImplementation.thirdPartySignInUp(input)
                }
                if (existingUsers.find(i => i.thirdParty !== undefined && i.thirdParty.id === input.thirdPartyId && i.thirdParty.userId === input.thirdPartyUserId)) {
                  // this means we are trying to sign in with the same social login. So we allow it
                  return originalImplementation.thirdPartySignInUp(input)
                }
                // this means that the email already exists with another social or email password login method, so we throw an error.
                throw new Error('Cannot sign up as email already exists')
              },
              async resetPasswordUsingToken(input) {
                const request = (input.userContext._default.request as FastifyRequest).getJSONBody()
                const body = await request
                if (!body)
                  throw new Error('There was a problem resetting the password.')

                const passwordMatchRegexp
                  = /^.*(?=.{8,})((?=.*[!@#$%^&*()\-_=+{};:,<.>]){1})(?=.*\d)((?=.*[a-z]){1})((?=.*[A-Z]){1}).*$/

                if (!passwordMatchRegexp.test(input.newPassword))
                  throw new Error('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number and one special character')

                if (body.rePassword !== input.newPassword)
                  throw new Error('Passwords do not match')

                const data = await originalImplementation.resetPasswordUsingToken(input)

                if (data.status === 'OK' && data.userId) {
                  const getUser = await ThirdPartyEmailPassword.getUserById(data.userId)

                  if (!getUser)
                    throw new Error('User not found')

                  // TODO: sifre sifirlandi emaili gonder
                  // await emailsService.passwordReset.mutate({
                  //   user: {
                  //     id: getUser.id,
                  //     email: getUser.email,
                  //   },
                  //   passwordResetLink: `${env.supertokens.websiteDomain}/auth/password/reset?token=${data.}`,
                  // })
                  //  { status: 'OK', userId: '1ba38f77-95b7-4b2d-9bfd-c86cac65cee5' }
                  console.log(data)
                  return data
                }
                else {
                  return data
                }
              },
            }
          },
          apis: originalImplementation => ({
            ...originalImplementation,
            emailPasswordSignInPOST: async (input) => {
              if (!originalImplementation.emailPasswordSignInPOST)
                throw new Error('emailPasswordSignInPOST is not available')

              const response = await originalImplementation.emailPasswordSignInPOST(input)

              if (response.status === 'OK') {
                await storage.userRepo.ensureUserExists({
                  superTokensUserId: response.user.id,
                  email: response.user.email,
                })
              }

              return response
            },
            emailPasswordSignUpPOST: async (input) => {
              if (!originalImplementation.emailPasswordSignUpPOST)
                throw new Error('emailPasswordSignUpPOST is not available')

              const response = await originalImplementation.emailPasswordSignUpPOST(input)

              if (response.status === 'OK') {
                await storage.userRepo.ensureUserExists({
                  superTokensUserId: response.user.id,
                  email: response.user.email,
                })
              }

              return response
            },
            thirdPartySignInUpPOST: async (input) => {
              try {
                const response = await originalImplementation.thirdPartySignInUpPOST!(input)

                if (!originalImplementation.thirdPartySignInUpPOST)
                  throw new Error('thirdPartySignInUpPOST is not available')

                if (response.status === 'OK') {
                  const externalUserId = response.user.thirdParty
                    ? `${response.user.thirdParty.id}|${response.user.thirdParty.userId}`
                    : null

                  await storage.userRepo.ensureUserExists({
                    superTokensUserId: response.user.id,
                    email: response.user.email,
                    externalAuthUserId: externalUserId || undefined,
                  })
                }

                return response
              }
              catch (err: any) {
                if (err.message === 'Cannot sign up as email already exists') {
                  // this error was thrown from our function override above.
                  // so we send a useful message to the user
                  return {
                    status: 'GENERAL_ERROR',
                    message: 'Seems like you already have an account with another method. Please use that instead.',
                  }
                }
                throw err
              }
            },
            async passwordResetPOST(input) {
              const result = await originalImplementation.passwordResetPOST!(input)

              // For security reasons we revoke all sessions when a password reset is performed.
              if (result.status === 'OK' && result.userId)
                await Session.revokeAllSessionsForUser(result.userId)

              return result
            },
          }),
        },
        emailDelivery: {
          override: originalImplementation => ({
            ...originalImplementation,
            async sendEmail(input) {
              if (input.type === 'PASSWORD_RESET') {
                if (env.environment !== 'production')
                  console.log('Password reset link:', input.passwordResetLink)

                await emailsService.sendPasswordResetEmail.mutate({
                  user: {
                    id: input.user.id,
                    email: input.user.email,
                  },
                  passwordResetLink: input.passwordResetLink,
                })
                return Promise.resolve()
              }

              return Promise.reject(new Error('Unsupported email type.'))
            },
          }),
        },
      }),
      EmailVerification.init({
        mode: env.auth.requireEmailVerification ? 'REQUIRED' : 'OPTIONAL',
        emailDelivery: {
          override: originalImplementation => ({
            ...originalImplementation,
            sendEmail: async (input) => {
              if (input.type === 'EMAIL_VERIFICATION') {
                if (env.environment !== 'production')
                  console.log('Password reset link:', input.emailVerifyLink)

                await emailsService.sendEmailVerificationEmail.mutate({
                  user: {
                    id: input.user.id,
                    email: input.user.email,
                  },
                  emailVerifyLink: input.emailVerifyLink,
                })

                return Promise.resolve()
              }
            },
          }),
        },
      }),
      Session.init({
        override: {
          functions: (originalImplementation) => {
            return {
              ...originalImplementation,
              async createNewSession(input) {
                const user = await ThirdPartyEmailPassword.getUserById(input.userId)
                const dbUser = await storage.userRepo.getUserBySuperTokenId({ superTokensUserId: input.userId })
                if (!user) {
                  throw new Error(
                    `Creating a new session failed. Could not find user with id ${input.userId}.`,
                  )
                }

                const externalUserId = user.thirdParty
                  ? `${user.thirdParty.id}|${user.thirdParty.userId}`
                  : null

                input.accessTokenPayload = {
                  version: '1',
                  superTokensUserId: input.userId,
                  externalUserId,
                  email: user.email,
                  username: dbUser?.username,
                }

                input.sessionData = {
                  version: '1',
                  superTokensUserId: input.userId,
                  externalUserId,
                  email: user.email,
                  username: dbUser?.username,
                }

                return originalImplementation.createNewSession(input)
              },
            }
          },
        },
      }), // initializes session features
      Dashboard.init({
        apiKey: 'c028e7f14a01d1ee1d742d6e049c937c',
      }),
    ],

  })
}
