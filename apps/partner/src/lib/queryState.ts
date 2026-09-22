/**
 * What a query's result may honestly be shown as.
 *
 * Four things look alike on a screen and mean opposite next steps: a list
 * that is still loading, a list the server refused, a list that arrived
 * empty, and a list that arrived once and then stopped refreshing. The
 * pages used to collapse the first, second and fourth into the third with
 * `data ?? []`, which told a cashier there were no purchases when the API was
 * unreachable and told a partner they were owed nothing when the balance
 * never loaded. This names the four so a page has to choose.
 */
export type DataState = 'loading' | 'error' | 'stale' | 'fresh';

export interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export function dataStateOf<T>(query: QueryLike<T>): DataState {
  if (query.data === undefined) return query.isError || !query.isPending ? 'error' : 'loading';
  // Data arrived at least once. If the most recent attempt to refresh it
  // failed, what is on screen is a snapshot, and must be labelled as one.
  if (query.isError || query.errorUpdatedAt > query.dataUpdatedAt) return 'stale';
  return 'fresh';
}

/** `14:05:31`, for "as of" labels. The date is implied: a snapshot older than a day is not a snapshot anyone should act on. */
export function clockTime(epochMs: number): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleTimeString('en-GB', { hour12: false });
}
