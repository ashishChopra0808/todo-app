import type { ApiErrorBody, ErrorCode } from '@todo/shared';

/** Error from the API (or the network), carrying the stable error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly fields: Record<string, string> = {},
    readonly retryAfterSeconds?: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Responses already requested by public/boot.js during page load; each is used once. */
function takeEarly(path: string): Promise<Response> | undefined {
  const w = window as { __todoEarly?: Record<string, Promise<Response>>; __todoEarlyAt?: number };
  const res = w.__todoEarly?.[path];
  if (!res) return undefined;
  delete w.__todoEarly![path];
  // Only for the first screen: never hand out a response from much earlier.
  return Date.now() - (w.__todoEarlyAt ?? 0) < 15_000 ? res : undefined;
}

/**
 * Same-origin JSON client. Cookies are HttpOnly and sent automatically; the API sits at /api
 * on the same origin (Vite proxy in dev, Cloudflare Pages proxy in staging/production).
 */
export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    const early = method === 'GET' ? takeEarly(path) : undefined;
    res = early
      ? await early
      : await fetch(path, {
          method,
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
          ...init,
        });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error as
      (ApiErrorBody['error'] & { retryAfterSeconds?: number; details?: unknown }) | undefined;
    throw new ApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? res.statusText,
      err?.fields ?? {},
      err?.retryAfterSeconds,
      err?.details,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T>(path: string, body?: unknown) => api<T>('DELETE', path, body);
