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
export type DataState = 'loading' | 'forbidden' | 'error' | 'stale' | 'fresh';

/** The HTTP status behind a query's failure, when there was one. */
export function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: number } } | undefined)?.response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

export interface QueryLike<T> {
  data: T | undefined;
  error?: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export function dataStateOf<T>(query: QueryLike<T>): DataState {
  // A refusal is not a failure to load, and the difference is the whole
  // point of naming it. "Could not load — check the connection and try
  // again" against a 403 tells somebody the app is broken and invites them
  // to press a button that will never work; what they need to know is that
  // this is not theirs to see and who can see it.
  if (httpStatusOf(query.error) === 403) return 'forbidden';
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
