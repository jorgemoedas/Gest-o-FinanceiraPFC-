import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Informe seu e-mail.')
  .max(320, 'O e-mail deve ter no máximo 320 caracteres.')
  .email('Informe um e-mail válido.');

const passwordSchema = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres na senha.')
  .max(72, 'A senha deve ter no máximo 72 caracteres.')
  .refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: 'A senha deve ocupar no máximo 72 bytes em UTF-8.'
  });

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1, 'Informe sua senha.')
      .max(72, 'A senha deve ter no máximo 72 caracteres.')
      .refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
        message: 'A senha deve ocupar no máximo 72 bytes em UTF-8.'
      })
  })
  .strict();

export const registerFormSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    companyName: z
      .string()
      .trim()
      .min(2, 'Informe o nome da empresa (mínimo de 2 caracteres).')
      .max(160, 'O nome da empresa deve ter no máximo 160 caracteres.'),
    acceptedTerms: z.boolean().refine((value) => value, {
      message: 'É necessário aceitar os Termos de Uso.'
    }),
    acceptedPrivacy: z.boolean().refine((value) => value, {
      message: 'É necessário aceitar a Política de Privacidade.'
    })
  })
  .strict();

export const registerRequestSchema = registerFormSchema
  .extend({
    termsVersion: z.string().min(1).max(40),
    privacyVersion: z.string().min(1).max(40)
  })
  .strict();

export const authResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal('Bearer'),
    expiresInSeconds: z.number().int().positive(),
    user: z
      .object({
        id: z.string().min(1),
        email: z.string().email(),
        companyId: z.string().min(1),
        companyName: z.string().min(1),
        role: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const currentUserSchema = z
  .object({
    userId: z.string().min(1),
    email: z.string().email(),
    companyId: z.string().min(1),
    role: z.string().min(1)
  })
  .strict();

export const documentVersionsSchema = z
  .object({
    termsVersion: z.string().min(1).max(40),
    privacyVersion: z.string().min(1).max(40)
  })
  .strict();

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
