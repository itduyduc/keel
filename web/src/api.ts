// One door to the server. Every write carries X-Requested-With, which the server
// requires on cookie-authenticated writes (another site cannot add it).
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'keel',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // WebKit says only "Load failed": the request never reached the server
    throw new ApiError(0, method === 'GET' ? "Can't reach Keel" : "Can't reach Keel — not saved");
  }
  if (r.status === 401) {
    onSignedOut();
    throw new ApiError(401, 'Signed out');
  }
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!r.ok) throw new ApiError(r.status, data?.error || `${r.status} ${r.statusText}`);
  return data as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);

// errors in a teammate's window land in the server log, so they can be diagnosed without them
let reported = 0;
export function reportClientError(message: string) {
  if (++reported > 20) return;
  fetch('/api/client-log', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'keel' },
    body: JSON.stringify({ level: 'error', message }),
  }).catch(() => {});
}
