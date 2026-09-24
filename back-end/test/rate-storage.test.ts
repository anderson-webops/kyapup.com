import type { Options } from 'express-rate-limit'
import { describe, expect, it } from 'vitest'
import { BoundedRateStore } from '../src/boundedRateStore.js'

describe('bounded rate storage', () => {
  it('preserves existing windows while excess identities share one bounded counter', () => {
    let now = 0
    const store = new BoundedRateStore(10_000, () => now)
    store.init({ windowMs: 60_000 } as Options)
    for (let i = 0; i < 10_000; i++)
      expect(store.increment(String(i)).totalHits).toBe(1)
    expect(store.increment('0').totalHits).toBe(2)
    for (let i = 0; i < 50_000; i++)
      expect(store.increment(`overflow-${i}`).totalHits).toBe(i + 1)
    store.decrement('not-an-existing-identity')
    expect(store.increment('new-overflow').totalHits).toBe(50_001)
    expect(store.increment('0').totalHits).toBe(3)
    now = 59_999
    expect(store.increment('0').resetTime?.getTime()).toBe(60_000)
    now = 60_000
    expect(store.increment('new-window').totalHits).toBe(1)
    expect(store.increment('0').totalHits).toBe(1)
    store.shutdown()
  })
})
