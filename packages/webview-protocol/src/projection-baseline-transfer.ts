import { z } from 'zod'
import { budgetFailure, protocolValueNodeCount } from './protocol-budget.js'

const MAX_PART_CHARS = 1024 * 1024
const MAX_PART_NODES = 80_000
const MAX_PARTS = 64
const MAX_BASELINE_CHARS = 8 * 1024 * 1024
const MAX_BASELINE_NODES = 1_000_000

const snapshotSchema = z
  .object({
    asOfSequence: z
      .number()
      .int()
      .min(-1)
      .refine((value) => Number.isSafeInteger(value)),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

export const projectionBaselinePartSchema = z
  .object({
    batchId: z.string().min(1).max(256),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_PARTS - 1),
    total: z.number().int().min(1).max(MAX_PARTS),
    projections: z.record(z.string().min(1).max(256), snapshotSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.index >= value.total ||
      budgetFailure(value) !== undefined ||
      protocolValueNodeCount(value) > MAX_PART_NODES ||
      JSON.stringify(value).length > MAX_PART_CHARS
    )
      context.addIssue({ code: 'custom', message: 'Invalid projection baseline part budget.' })
  })

export type ProjectionBaselinePart = z.infer<typeof projectionBaselinePartSchema>
export type ProjectionBaseline = { readonly projections: ProjectionBaselinePart['projections'] }

/** 全量基线保持原语义，仅拆分传输；绝不通过放宽通用消息上限发送整份大基线。 */
export function splitProjectionBaseline(
  payload: unknown,
  batchId: string,
): readonly ProjectionBaselinePart[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('projections' in payload) ||
    typeof payload.projections !== 'object' ||
    payload.projections === null ||
    Array.isArray(payload.projections)
  )
    throw new Error('Invalid projection baseline.')
  const projections = payload.projections as Record<string, unknown>
  const groups: ProjectionBaselinePart['projections'][] = []
  let current: ProjectionBaselinePart['projections'] = Object.create(
    null,
  ) as ProjectionBaselinePart['projections']
  let nodes = 0
  let chars = 0
  let partNodes = 0
  let partChars = 0
  for (const [id, raw] of Object.entries(projections)) {
    const snapshot = snapshotSchema.parse(raw)
    const weight = protocolValueNodeCount({ [id]: snapshot })
    const length = JSON.stringify({ [id]: snapshot }).length
    nodes += weight
    chars += length
    if (nodes > MAX_BASELINE_NODES || chars > MAX_BASELINE_CHARS)
      throw new Error('Projection baseline exceeds transfer budget.')
    if (
      partNodes > 0 &&
      (partNodes + weight > MAX_PART_NODES - 32 || partChars + length > MAX_PART_CHARS - 1024)
    ) {
      groups.push(current)
      current = Object.create(null) as ProjectionBaselinePart['projections']
      partNodes = 0
      partChars = 0
    }
    current[id] = snapshot
    partNodes += weight
    partChars += length
  }
  if (Object.keys(current).length > 0 || groups.length === 0) groups.push(current)
  if (groups.length > MAX_PARTS) throw new Error('Projection baseline requires too many parts.')
  return groups.map((group, index) =>
    projectionBaselinePartSchema.parse({
      batchId,
      index,
      total: groups.length,
      projections: group,
    }),
  )
}

interface PendingBaseline {
  readonly batchId: string
  readonly total: number
  readonly projections: ProjectionBaselinePart['projections']
  next: number
  nodes: number
  chars: number
}

/** 只接收连续、有界的一份基线；全部收齐前不覆盖界面既有投影。 */
export class ProjectionBaselineReceiver {
  private pending: PendingBaseline | undefined

  public clear(): void {
    this.pending = undefined
  }

  public accept(part: ProjectionBaselinePart): ProjectionBaseline | undefined {
    if (part.index === 0)
      this.pending = {
        batchId: part.batchId,
        total: part.total,
        projections: Object.create(null) as ProjectionBaselinePart['projections'],
        next: 0,
        nodes: 0,
        chars: 0,
      }
    const pending = this.pending
    if (
      pending === undefined ||
      pending.batchId !== part.batchId ||
      pending.total !== part.total ||
      pending.next !== part.index
    ) {
      this.clear()
      return undefined
    }
    pending.nodes += protocolValueNodeCount(part.projections)
    pending.chars += JSON.stringify(part.projections).length
    if (
      pending.nodes > MAX_BASELINE_NODES ||
      pending.chars > MAX_BASELINE_CHARS ||
      Object.keys(part.projections).some((id) => Object.hasOwn(pending.projections, id))
    ) {
      this.clear()
      return undefined
    }
    Object.assign(pending.projections, part.projections)
    pending.next++
    if (pending.next !== pending.total) return undefined
    this.clear()
    return { projections: pending.projections }
  }
}
