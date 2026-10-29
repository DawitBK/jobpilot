import { baseEnvSchema } from '@jobpilot/kit';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  /** The runtime database role. It must NOT be able to bypass row-level security. */
  DATABASE_URL: z
    .string()
    .min(1)
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  /** HMAC key for access tokens; at least 32 characters so a weak key fails at boot. */
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Single sign-on: set all three, or none. */
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Single sign-on, optional: where THIS server reaches the provider (for example http://sso:7300), so server-to-server
   * calls stay off the public internet. An absolute http or https URL without a trailing slash. Browsers keep using OIDC_ISSUER.
   */
  OIDC_INTERNAL_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http or https URL' })
    .refine((value) => !value.endsWith('/'), 'must not end with a slash')
    .optional(),
  /** How often the outbox dispatcher looks for new events, in milliseconds; 0 turns it off. */
  OUTBOX_POLL_MS: z.coerce.number().int().min(0).max(3_600_000).default(2000),
  /** The public address of the web app: the links in emails. Required with SMTP_URL. */
  APP_URL: z
    .url({ protocol: /^https?$/, error: 'must be an absolute http or https URL' })
    .optional(),
  /** Outgoing mail, optional: smtp:// or smtps:// with credentials. Without it, notifications stay in the app. */
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'must be an smtp:// or smtps:// URL')
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  /** Development only: write every email to a text file in this folder instead of sending it. Refused in production. */
  MAIL_OUTBOX_DIR: z.string().min(1).optional(),
  /** 32 random bytes, base64 (openssl rand -base64 32). Encrypts two-step sign-in secrets and organization credentials; without it neither can be stored. */
  SECRETS_KEY: z.string().min(1).optional(),
  /** The key before a rotation: values made with it can still be read until they are written again. */
  SECRETS_KEY_PREVIOUS: z.string().min(1).optional(),
  /**
   * The server's own AI connection, used when an organization saved none. Same names as DMS: AI_PROVIDER forces a vendor
   * (groq, openai, anthropic, custom); otherwise the first of GROQ_API_KEY, OPENAI_API_KEY, AI_BASE_URL + AI_API_KEY
   * (any OpenAI-compatible endpoint) and ANTHROPIC_API_KEY that is set. Without any, AI writing says it is not set up.
   */
  AI_PROVIDER: z.enum(['groq', 'openai', 'anthropic', 'custom']).optional(),
  GROQ_API_KEY: z.string().min(8).optional(),
  GROQ_MODEL: z.string().min(2).optional(),
  OPENAI_API_KEY: z.string().min(8).optional(),
  OPENAI_MODEL: z.string().min(2).optional(),
  OPENAI_BASE_URL: z.url().optional(),
  AI_BASE_URL: z.url().optional(),
  AI_API_KEY: z.string().min(8).optional(),
  AI_MODEL: z.string().min(2).optional(),
  ANTHROPIC_API_KEY: z.string().min(8).optional(),
  ANTHROPIC_MODEL: z.string().min(2).optional(),
  /** Let an organization point at a private address (a local Ollama or vLLM). Only for a server that is yours alone. */
  AI_ALLOW_PRIVATE_URLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(60 * 60 * 24 * 14),
});

export type Env = z.output<typeof envSchema>;
