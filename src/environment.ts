import zod from 'zod'
import { config } from 'dotenv'

config()

const isNumberString = (input: unknown) => zod.string().regex(/^\d+$/).safeParse(input).success

const numberFromNumberOrNumberString = (input: unknown): number | undefined => {
  if (typeof input == 'number')
    return input
  if (isNumberString(input))
    return Number(input)
}

const NumberFromString = zod.preprocess(numberFromNumberOrNumberString, zod.number().min(1))

// treat an empty string (`''`) as undefined
const emptyString = <T extends zod.ZodType>(input: T) => {
  return zod.preprocess((value: unknown) => {
    if (value === '')
      return undefined
    return value
  }, input)
}

const EnvironmentModel = zod.object({
  PORT: emptyString(NumberFromString.optional()),
  ENVIRONMENT: emptyString(zod.string().optional()),
  RELEASE: emptyString(zod.string().optional()),
  ENCRYPTION_SECRET: emptyString(zod.string()),
  WEB_APP_URL: emptyString(zod.string().url().optional()),
  RATE_LIMIT_ENDPOINT: emptyString(zod.string().url().optional()),
  USAGE_ESTIMATOR_ENDPOINT: emptyString(zod.string().url().optional()),
  BILLING_ENDPOINT: emptyString(zod.string().url().optional()),
  EMAILS_ENDPOINT: emptyString(zod.string().url()),
  AUTH_REQUIRE_EMAIL_VERIFICATION: emptyString(zod.union([zod.literal('1'), zod.literal('0')])),
})

const PostgresModel = zod.object({
  POSTGRES_SSL: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_DROP_SCHEMA: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_HOST: zod.string(),
  POSTGRES_PORT: NumberFromString,
  POSTGRES_DB: zod.string(),
  POSTGRES_USER: zod.string(),
  POSTGRES_PASSWORD: zod.string(),
  POSTGRES_MIGRATIONS: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_SEEDS: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_SYNCHRONIZE: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_DEBUG: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
  POSTGRES_URL: emptyString(zod.string().url().optional()),
  POSTGRES_HIGHLIGHT: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).optional()),
})

const SuperTokensModel = zod.object({
  SUPERTOKENS_CONNECTION_URI: zod.string().url(),
  SUPERTOKENS_API_KEY: zod.string(),
  SUPERTOKENS_API_DOMAIN: zod.string().url(),
  SUPERTOKENS_WEBSITE_DOMAIN: zod.string().url(),
  SUPERTOKENS_APP_NAME: zod.string(),
})

const ClickHouseModel = zod.object({
  CLICKHOUSE_PROTOCOL: zod.union([zod.literal('http'), zod.literal('https')]),
  CLICKHOUSE_HOST: zod.string(),
  CLICKHOUSE_PORT: NumberFromString,
  CLICKHOUSE_USERNAME: zod.string(),
  CLICKHOUSE_PASSWORD: zod.string(),
}).deepPartial().optional()

const RedisModel = zod.object({
  REDIS_HOST: zod.string(),
  REDIS_PORT: NumberFromString,
  REDIS_PASSWORD: emptyString(zod.string().optional()),
  REDIS_URL: zod.string(),
})

const GitHubModel
  = zod.object({
    AUTH_GITHUB: emptyString(zod.union([zod.literal('1'), zod.literal('0')]).default('0')),
    AUTH_GITHUB_APP_ID: zod.string(),
    AUTH_GITHUB_APP_PRIVATE_KEY: zod.string(),
  })

const S3Model = zod.object({
  S3_ENDPOINT: zod.string().url(),
  S3_ACCESS_KEY_ID: zod.string(),
  S3_SECRET_ACCESS_KEY: zod.string(),
  S3_BUCKET_NAME: zod.string(),
  S3_PUBLIC_URL: emptyString(zod.string().url().optional()),
  CDN_AUTH_PRIVATE_KEY: zod.string().optional(),
})

const LogModel = zod.object({
  LOG_LEVEL: emptyString(
    zod
      .union([
        zod.literal('trace'),
        zod.literal('debug'),
        zod.literal('info'),
        zod.literal('warn'),
        zod.literal('error'),
        zod.literal('fatal'),
        zod.literal('silent'),
      ])
      .optional(),
  ),
})

const configs = {

  base: EnvironmentModel.safeParse(process.env),

  postgres: PostgresModel.safeParse(process.env),

  clickhouse: ClickHouseModel.safeParse(process.env),

  redis: RedisModel.safeParse(process.env),

  supertokens: SuperTokensModel.safeParse(process.env),

  github: GitHubModel.safeParse(process.env),

  s3: S3Model.safeParse(process.env),

  log: LogModel.safeParse(process.env),
}

const environmentErrors: Array<string> = []

for (const config of Object.values(configs)) {
  if (config.success === false)
    environmentErrors.push(JSON.stringify(config.error.format(), null, 4))
}

if (environmentErrors.length) {
  const fullError = environmentErrors.join('\n')
  console.error('❌ Invalid environment variables:', fullError)
  process.exit(1)
}

function extractConfig<Input, Output>(config: zod.SafeParseReturnType<Input, Output>): Output {
  if (!config.success)
    throw new Error('Something went wrong.')

  return config.data
}

const base = extractConfig(configs.base)
const postgres = extractConfig(configs.postgres)
const clickhouse = extractConfig(configs.clickhouse)
const redis = extractConfig(configs.redis)
const supertokens = extractConfig(configs.supertokens)
const authGithub = extractConfig(configs.github)
const log = extractConfig(configs.log)

const s3 = extractConfig(configs.s3)

export const env = {
  environment: base.ENVIRONMENT,
  release: base.RELEASE ?? 'local',
  encryptionSecret: base.ENCRYPTION_SECRET,
  emailsEndpoint: base.EMAILS_ENDPOINT,
  http: {
    port: base.PORT ?? 3001,
  },
  postgres: {
    host: postgres.POSTGRES_HOST,
    port: postgres.POSTGRES_PORT,
    db: postgres.POSTGRES_DB,
    user: postgres.POSTGRES_USER,
    password: postgres.POSTGRES_PASSWORD,
    ssl: postgres.POSTGRES_SSL === '1',
    dropShema: postgres.POSTGRES_DROP_SCHEMA === '1',
    migrations: postgres.POSTGRES_MIGRATIONS === '1',
    seeds: postgres.POSTGRES_SEEDS === '1',
    synchronize: postgres.POSTGRES_SYNCHRONIZE === '1',
    debug: postgres.POSTGRES_DEBUG === '1',
    url: postgres.POSTGRES_URL,
    highlight: postgres.POSTGRES_HIGHLIGHT === '1',
  },
  clickhouse: {
    protocol: clickhouse?.CLICKHOUSE_PROTOCOL,
    host: clickhouse?.CLICKHOUSE_HOST,
    port: clickhouse?.CLICKHOUSE_PORT,
    username: clickhouse?.CLICKHOUSE_USERNAME,
    password: clickhouse?.CLICKHOUSE_PASSWORD,
  },
  redis: {
    host: redis.REDIS_HOST,
    port: redis.REDIS_PORT,
    password: redis.REDIS_PASSWORD ?? '',
    url: redis.REDIS_URL,
  },
  supertokens: {
    connectionURI: supertokens.SUPERTOKENS_CONNECTION_URI,
    apiKey: supertokens.SUPERTOKENS_API_KEY,
    apiDomain: supertokens.SUPERTOKENS_API_DOMAIN,
    websiteDomain: supertokens.SUPERTOKENS_WEBSITE_DOMAIN,
    appName: supertokens.SUPERTOKENS_APP_NAME,
  },
  auth: {
    github: authGithub.AUTH_GITHUB === '1',
    github_secret:
         {
           appId: authGithub.AUTH_GITHUB_APP_ID,
           privateKey: authGithub.AUTH_GITHUB_APP_PRIVATE_KEY,
         },
    requireEmailVerification: base.AUTH_REQUIRE_EMAIL_VERIFICATION === '1',
  },
  s3: {
    bucketName: s3.S3_BUCKET_NAME,
    endpoint: s3.S3_ENDPOINT,
    publicUrl: s3.S3_PUBLIC_URL ?? null,
    credentials: {
      accessKeyId: s3.S3_ACCESS_KEY_ID,
      secretAccessKey: s3.S3_SECRET_ACCESS_KEY,
    },
  },
  log: {
    level: log.LOG_LEVEL ?? 'info',
  },

} as const
