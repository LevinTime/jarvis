export async function probeT3(pageUrl: string, timeoutMs = 1200): Promise<{ reachable: boolean; status: number }> {
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
