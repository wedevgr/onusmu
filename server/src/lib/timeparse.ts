/** A [from, to) window of time, used to limit search, chat and the ledger to a period. */
export interface TimeRange {
  from: Date;
  to: Date;
}
