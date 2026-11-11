export function t3BaseHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function t3ProbeAllowed(pageUrl: string, baseUrl: string): boolean {
  const page = t3BaseHost(pageUrl);
  const base = t3BaseHost(baseUrl);
  return page !== null && page === base;
}

export async function probeT3(
  pageUrl: string,
  timeoutMs = 1200,
  allowedBase?: string,
): Promise<{ reachable: boolean; status: number }> {
  if (allowedBase !== undefined && !t3ProbeAllowed(pageUrl, allowedBase)) {
    return { reachable: false, status: 0 };
  }
  let target: string;
  try {
    const url = new URL(pageUrl);
    url.pathname = "/.well-known/t3/environment";
    url.search = "";
    url.hash = "";
    target = url.toString();
  } catch {
    return { reachable: false, status: 0 };
  }
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: response.status > 0 && response.status < 500, status: response.status };
  } catch {
    return { reachable: false, status: 0 };
  }
}
