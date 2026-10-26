import { z } from 'zod'
import { id, requestBase } from './request-common.js'

export const connectionRequestSchemas = [
  z
    .object({
      type: z.literal('workspace.browser'),
      ...requestBase,
      payload: z
        .object({
          action: z.enum(['list', 'sessions', 'preview', 'open', 'choose', 'temporary', 'resume']),
          workspaceId: id.optional(),
          sessionId: id.optional(),
          beforeSequence: z.number().int().nonnegative().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('app.ready'), ...requestBase }).strict(),
  z.object({ type: z.literal('connection.retry'), ...requestBase }).strict(),
  z
    .object({
      type: z.literal('connection.configure'),
      ...requestBase,
      payload: z
        .object({
          mode: z.enum(['auto', 'custom', 'desktop', 'local']),
          // Desktop launch input is write-only; Host separates credentials before storage.
          endpoint: z.string().max(8192).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.action'),
      ...requestBase,
      payload: z
        .object({
          action: z.enum([
            'install',
            'select',
            'copy-command',
            'open-docs',
            'connect-desktop',
            'open-web-ui',
            'open-editor',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.update.check'),
      ...requestBase,
      payload: z.object({ force: z.boolean().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.update.install'),
      ...requestBase,
      payload: z.object({ version: z.string().min(1).max(128) }).strict(),
    })
    .strict(),
] as const
