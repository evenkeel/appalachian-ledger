let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};

/**
 * The website demo has no server. There, every request is answered from saved fictional
 * responses by this stand-in, and nothing below it ever runs. The app itself never sets one.
 */
export interface StandIn {
  request: (path: string, method: string, body?: unknown) => Promise<unknown>;
  download: (path: string, filename: string) => Promise<void>;
}
let standIn: StandIn | null = null;
export const setStandIn = (value: StandIn | null) => {
  standIn = value;
};

function checkSession(response: Response) {
  if (response.status === 401 && csrf) {
    csrf = "";
    window.dispatchEvent(new Event("ledger:session-expired"));
  }
}

const incompatibleServer =
  "This feature is unavailable on the running server. Restart the ledger with the latest code, then reload this page.";

async function responseError(response: Response) {
  const error = await response.json().catch(() => null);
  const detail = error?.detail;
  if (
    response.status === 405 ||
    (response.status === 404 && detail === "Not Found")
  )
    return incompatibleServer;
  if (Array.isArray(detail))
    return (
      detail
        .map((e: { loc?: (string | number)[]; msg?: string }) =>
          [e.loc?.slice(1).join(" "), e.msg].filter(Boolean).join(": "),
        )
        .join("; ") || `Request failed (${response.status})`
    );
  return typeof detail === "string" && detail
    ? detail
    : `Request failed (${response.status})`;
}

async function checkResponse(response: Response) {
  checkSession(response);
  if (!response.ok) throw new Error(await responseError(response));
  // A static-file fallback can return the app HTML for an unknown API route.
  if (response.headers.get("Content-Type")?.includes("text/html"))
    throw new Error(incompatibleServer);
}

export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (standIn) return standIn.request(path, method, body) as Promise<T>;
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  await checkResponse(response);
  return response.json() as Promise<T>;
}
export async function download(path: string, filename: string, body?: unknown) {
  if (standIn) return standIn.download(path, filename);
  const response = await fetch("/api" + path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  await checkResponse(response);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
