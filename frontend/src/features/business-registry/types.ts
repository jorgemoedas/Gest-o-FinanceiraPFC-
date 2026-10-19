import { z } from 'zod';

const cnpjSchema = z.string().regex(/^[A-Z0-9]{12}\d{2}$/);
const nullableTextSchema = z.string().nullable();

export const businessRegistryRecordSchema = z.object({
  cnpj: cnpjSchema,
  legalName: z.string().min(1),
  tradeName: nullableTextSchema,
  registrationStatus: nullableTextSchema,
  companyType: nullableTextSchema,
  size: nullableTextSchema,
  openingDate: nullableTextSchema,
  mainActivity: z.object({
    code: nullableTextSchema,
    description: nullableTextSchema
  }).strict().nullable(),
  address: z.object({
    street: nullableTextSchema,
    number: nullableTextSchema,
    complement: nullableTextSchema,
    district: nullableTextSchema,
    city: nullableTextSchema,
    state: nullableTextSchema,
    postalCode: nullableTextSchema
  }).strict(),
  source: z.literal('ReceitaWS'),
  sourceUpdatedAt: z.string().datetime()
}).strict();

export type BusinessRegistryRecord = z.infer<typeof businessRegistryRecordSchema>;
