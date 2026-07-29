/** Shared async load contract for session configuration surfaces (Solution 09). */
export type AsyncResource<T> =
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "error"; message: string; retryable: boolean };

export function asyncLoading<T>(): AsyncResource<T> {
  return { status: "loading" };
}

export function asyncLoaded<T>(value: T): AsyncResource<T> {
  return { status: "loaded", value };
}

export function asyncError<T>(
  message: string,
  retryable = true,
): AsyncResource<T> {
  return { status: "error", message, retryable };
}
