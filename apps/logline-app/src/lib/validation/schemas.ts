import { z } from 'zod';

export const CheckoutBodySchema = z.object({
  installationId: z.coerce.number().int().positive(),
});

export const InstallQuerySchema = z.object({
  installation_id: z.string().regex(/^\d+$/, 'installation_id must be numeric'),
  setup_action: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
});

export const IngestBodySchema = z.object({
  event: z.string().min(1),
  properties: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
  environment: z.string().optional(),
});

export const BatchIngestBodySchema = z.object({
  events: z.array(z.object({
    event: z.string().min(1),
    properties: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
    environment: z.string().optional(),
  })).min(1).max(100),
});
