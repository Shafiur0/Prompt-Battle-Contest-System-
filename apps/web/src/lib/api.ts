export class ApiError extends Error {
 constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); this.name = "ApiError"; }
}
type ApiOptions = RequestInit & { json?: unknown; idempotencyKey?: string };
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
 const { json, idempotencyKey, ...init } = options;
 const headers = new Headers(init.headers);
 headers.set("Accept", "application/json");
 if (json !== undefined) headers.set("Content-Type", "application/json");
 if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
 const response = await fetch("/api/v1" + path, { ...init, headers, credentials: "include", cache: "no-store", body: json === undefined ? init.body : JSON.stringify(json) });
 let data: unknown;
 try { data = await response.json(); } catch { throw new ApiError("The competition service is not available yet. Please try again shortly.", response.status); }
 if (!response.ok) {
  const item = data as { message?: string | string[]; code?: string; error?: string };
  const message = Array.isArray(item.message) ? item.message.join(". ") : item.message || "This request could not be completed.";
  throw new ApiError(message, response.status, item.code || item.error);
 }
 return data as T;
}
export function errorMessage(error: unknown) {
 if (error instanceof ApiError) return error.message;
 if (error instanceof Error && error.name === "AbortError") return "";
 return "Could not connect to the competition service. Your saved attempts remain on the server.";
}
