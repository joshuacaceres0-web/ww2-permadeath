// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Standalone builds (itch): VITE_LOCAL_SAVE=1 at build time swaps
// the server for the local save backend in ./localBackend — the
// campaign then lives in the player's own browser storage and no
// request ever leaves the device. Normal builds never load it.
const LOCAL = import.meta.env.VITE_LOCAL_SAVE === "1";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  if (LOCAL) {
    const { localRequest } = await import("./localBackend");
    return localRequest<T>(method, path, body);
  }
  // Auth rides the httpOnly session cookie automatically — never add auth headers here.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? { "X-Save-Id": saveId() } : { "Content-Type": "application/json", "X-Save-Id": saveId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

// Save slot for this browser. Default "main" is the original save; set localStorage
// "vanguard-save-id" to anything else (e.g. in tests) to play an isolated save.
export function saveId(): string {
  try {
    return localStorage.getItem("vanguard-save-id") || "main";
  } catch {
    return "main";
  }
}

/**
 * The pagehide battle filing (Battlefield's retreat beacon): a
 * fire-and-forget POST of the battle report. Behind the server it
 * is the same fetch it always was; in a local build it files into
 * the browser save instead, so a closed tab still counts.
 */
export function fileBattleBeacon(body: JsonBody): Promise<unknown> {
  if (LOCAL) {
    return import("./localBackend").then(({ localRequest }) =>
      localRequest("POST", "/battle/complete", body).catch(() => undefined),
    );
  }
  return fetch(`${BASE}/battle/complete`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-Save-Id": saveId() },
    body: JSON.stringify(body),
  });
}
