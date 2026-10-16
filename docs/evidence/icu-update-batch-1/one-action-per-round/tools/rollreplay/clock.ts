// fake clock — installed before any app module evaluates
export const clock = { now: 0 }
const RealDate = Date
class FakeDate extends RealDate {
  constructor(...a: unknown[]) { if (a.length === 0) super(clock.now); else super(...(a as [number])) }
  static now() { return clock.now }
}
;(globalThis as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor
