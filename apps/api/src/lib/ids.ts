import { v7 } from 'uuid';

/** Time-ordered UUIDs (v7) for all primary keys. */
export const newId = (): string => v7();
