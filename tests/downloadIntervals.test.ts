import { describe, expect, it } from 'vitest'
import { msUntilCanStartTask } from '../server/utils/downloadIntervals'

describe('msUntilCanStartTask', () => {
  const base = {
    lastStartedAt: null as number | null,
    lastFinishedAt: null as number | null,
    taskStartIntervalSec: 0,
    downloadIntervalSec: 0,
  }

  it('returns 0 when intervals disabled', () => {
    expect(
      msUntilCanStartTask({
        ...base,
        now: 10_000,
        lastStartedAt: 9_000,
        lastFinishedAt: 9_500,
      }),
    ).toBe(0)
  })

  it('waits for task start interval from last start', () => {
    expect(
      msUntilCanStartTask({
        ...base,
        now: 10_000,
        lastStartedAt: 8_000,
        taskStartIntervalSec: 3,
      }),
    ).toBe(1000)
  })

  it('waits for download interval from last finish', () => {
    expect(
      msUntilCanStartTask({
        ...base,
        now: 10_000,
        lastFinishedAt: 9_000,
        downloadIntervalSec: 5,
      }),
    ).toBe(4000)
  })

  it('takes the larger of start and finish waits', () => {
    expect(
      msUntilCanStartTask({
        now: 10_000,
        lastStartedAt: 9_500,
        lastFinishedAt: 8_000,
        taskStartIntervalSec: 2,
        downloadIntervalSec: 5,
      }),
    ).toBe(3000) // max(1500 from start, 3000 from finish)
  })

  it('ignores null timestamps', () => {
    expect(
      msUntilCanStartTask({
        now: 10_000,
        lastStartedAt: null,
        lastFinishedAt: null,
        taskStartIntervalSec: 10,
        downloadIntervalSec: 10,
      }),
    ).toBe(0)
  })
})
