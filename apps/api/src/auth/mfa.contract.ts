import { z } from 'zod';

const code = z.string().regex(/^\d{6}$/, 'The code is six digits');
const recoveryCode = z.string().trim().min(8).max(40);

/** What sign-in returns instead of tokens when the account has two-step sign-in on. */
export const mfaChallengeSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
});
export type MfaChallenge = z.output<typeof mfaChallengeSchema>;

const oneOf = (v: { code?: string; recoveryCode?: string }) =>
  Boolean(v.code) !== Boolean(v.recoveryCode);
const oneOfMessage = 'Send either a code or a recovery code, not both';

export const mfaLoginSchema = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    code: code.optional(),
    recoveryCode: recoveryCode.optional(),
  })
  .strict()
  .refine(oneOf, oneOfMessage);
export type MfaLogin = z.output<typeof mfaLoginSchema>;

export const mfaStatusSchema = z.object({
  available: z
    .boolean()
    .describe('False when the server has no SECRETS_KEY, so two-step sign-in cannot be stored'),
  enabled: z.boolean(),
  recoveryCodesLeft: z.number().int(),
});

export const mfaSetupSchema = z.object({ secret: z.string(), otpauthUrl: z.string() });
export const mfaEnableSchema = z.object({ code }).strict();
export type MfaEnable = z.output<typeof mfaEnableSchema>;
export const mfaCodesSchema = z.object({ recoveryCodes: z.array(z.string()) });

export const mfaDisableSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: code.optional(),
    recoveryCode: recoveryCode.optional(),
  })
  .strict()
  .refine(oneOf, oneOfMessage);
export type MfaDisable = z.output<typeof mfaDisableSchema>;
