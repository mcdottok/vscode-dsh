import { z } from 'zod'

export const extensionUpdateSchema = z
  .object({
    version: z
      .string()
      .max(64)
      .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
    publishedAt: z.iso.datetime(),
    downloadUrl: z.string().max(256),
  })
  .strict()
  .refine(({ version, downloadUrl }) =>
    ['', 'v'].some(
      (prefix) =>
        downloadUrl ===
        `https://github.com/mcdottok/vscode-dsh/releases/download/${prefix}${version}/dsh-coding-agent-${version}.vsix`,
    ),
  )

export type ExtensionUpdate = z.infer<typeof extensionUpdateSchema>
