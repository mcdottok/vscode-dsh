import { describe, expect, it } from 'vitest'
import {
  ProjectionBaselineReceiver,
  splitProjectionBaseline,
  projectionBaselinePartSchema,
} from './projection-baseline-transfer.js'
import { hostEnvelopeSchema } from './host-schemas.js'
import { budgetFailure } from './protocol-budget.js'

function baseline(count: number): {
  projections: Record<string, { asOfSequence: number; values: Record<string, unknown> }>
} {
  return {
    projections: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `session-${index}`,
        {
          asOfSequence: index,
          values: {
            title: `Title ${index}`,
            rows: Array.from({ length: 100 }, (_, row) => ({ row, valid: true })),
          },
        },
      ]),
    ),
  }
}

describe('bounded projection baseline transfer', () => {
  it('delivers an over-budget whole baseline in valid bounded parts and applies it atomically', () => {
    const original = baseline(300)
    expect(budgetFailure(original)).toBe('The protocol message contains too many values.')
    const parts = splitProjectionBaseline(original, 'batch-1')
    expect(parts.length).toBeGreaterThan(1)
    const receiver = new ProjectionBaselineReceiver()
    for (const [index, part] of parts.entries()) {
      expect(
        hostEnvelopeSchema.safeParse({
          protocolVersion: 1,
          message: {
            type: 'event',
            name: 'session.projection.baseline.part',
            sequence: index,
            payload: part,
          },
        }).success,
      ).toBe(true)
      const result = receiver.accept(part)
      if (index === parts.length - 1) expect(result).toEqual(original)
      else expect(result).toBeUndefined()
    }
  })

  it('does not merge missing, mixed, duplicate or interrupted batches into a partial baseline', () => {
    const parts = splitProjectionBaseline(baseline(300), 'batch-1')
    const receiver = new ProjectionBaselineReceiver()
    expect(receiver.accept(parts[0]!)).toBeUndefined()
    expect(receiver.accept({ ...parts[1]!, batchId: 'another' })).toBeUndefined()
    expect(receiver.accept(parts.at(-1)!)).toBeUndefined()
    expect(receiver.accept(parts[0]!)).toBeUndefined()
    receiver.clear()
    expect(receiver.accept(parts[1]!)).toBeUndefined()
    const duplicate = projectionBaselinePartSchema.parse({ ...parts[0]!, index: 1 })
    receiver.accept(parts[0]!)
    expect(receiver.accept(duplicate)).toBeUndefined()
  })

  it('rejects a transfer above the aggregate budget without publishing it', () => {
    const projections = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `session-${index}`,
        { asOfSequence: index, values: { text: 'x'.repeat(1024 * 1024) } },
      ]),
    )
    expect(() => splitProjectionBaseline({ projections }, 'oversized')).toThrow('transfer budget')
    const receiver = new ProjectionBaselineReceiver()
    for (let index = 0; index < 9; index++) {
      expect(
        receiver.accept({
          batchId: 'oversized',
          index,
          total: 9,
          projections: {
            [`session-${index}`]: { asOfSequence: index, values: { text: 'x'.repeat(1024 * 1024) } },
          },
        }),
      ).toBeUndefined()
    }
  })

  it('supports empty baselines and refuses oversized individual session projections', () => {
    const parts = splitProjectionBaseline({ projections: {} }, 'empty')
    expect(new ProjectionBaselineReceiver().accept(parts[0]!)).toEqual({ projections: {} })
    expect(() =>
      splitProjectionBaseline(
        { projections: { session: { asOfSequence: 1, values: { text: 'x'.repeat(1200 * 1024) } } } },
        'large',
      ),
    ).toThrow()
    expect(projectionBaselinePartSchema.safeParse({ ...parts[0], index: 1 }).success).toBe(false)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(
      projectionBaselinePartSchema.safeParse({
        ...parts[0],
        projections: {
          session: { asOfSequence: 1, values: { cyclic } },
        },
      }).success,
    ).toBe(false)
  })
})
