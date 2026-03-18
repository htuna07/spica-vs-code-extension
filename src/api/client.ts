import { SpicaApiError } from "../utils/errors.js";
import type { AuthScheme } from "../utils/constants.js";
import type { ErrorResponse } from "../models/types.js";

/**
 * Central HTTP client for the Spica API.
 * All service modules use this singleton to make requests.
 */
export class SpicaClient {
  private static _instance: SpicaClient | undefined;

  private _baseUrl = "";
  private _authScheme: AuthScheme = "IDENTITY";
  private _token = "";

  private constructor() {}

  static get instance(): SpicaClient {
    if (!SpicaClient._instance) {
      SpicaClient._instance = new SpicaClient();
    }
    return SpicaClient._instance;
  }

  // ── Configuration ───────────────────────────────────────────────────

  get baseUrl(): string {
    return this._baseUrl;
  }

  configure(baseUrl: string, authScheme: AuthScheme, token: string): void {
    // Strip trailing slash
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this._authScheme = authScheme;
    this._token = token;
  }

  setToken(token: string): void {
    this._token = token;
  }

  get isConfigured(): boolean {
    return this._baseUrl.length > 0 && this._token.length > 0;
  }

  reset(): void {
    this._baseUrl = "";
    this._token = "";
  }

  // ── Health check ────────────────────────────────────────────────────

  /**
   * Check that the server is reachable.
   * Any HTTP response (even 401) is accepted as "alive".
   */
  async healthCheck(url: string): Promise<boolean> {
    try {
      const cleanUrl = url.replace(/\/+$/, "");
      const resp = await fetch(`${cleanUrl}/status/ready`, {
        method: "GET",
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── Core request method ──────────────────────────────────────────────

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    const url = `${this._baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `${this._authScheme} ${this._token}`,
    };

    if (body !== undefined) {
      headers["Content-Type"] = contentType ?? "application/json";
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (resp.status === 204) {
      return undefined as T;
    }

    const text = await resp.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (!resp.ok) {
        throw new SpicaApiError(resp.status, text || resp.statusText);
      }
      return text as T;
    }

    if (!resp.ok) {
      const errBody = json as ErrorResponse;
      throw SpicaApiError.fromResponse(errBody);
    }

    return json as T;
  }

  // ── Convenience methods ──────────────────────────────────────────────

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  patch<T = unknown>(
    path: string,
    body?: unknown,
    contentType = "application/merge-patch+json",
  ): Promise<T> {
    return this.request<T>("PATCH", path, body, contentType);
  }

  delete(path: string): Promise<void> {
    return this.request<void>("DELETE", path);
  }

  /**
   * Returns the WebSocket URL and auth headers for a given API path.
   * The base URL scheme (http/https) is converted to ws/wss automatically.
   */
  getWsConnectionOptions(
    path: string,
    query?: URLSearchParams,
  ): { url: string } {
    const wsBase = this._baseUrl.replace("http", "ws");

    query?.append("Authorization", `${this._authScheme} ${this._token}`);

    const qs = query?.toString();
    const url = `${wsBase}${path}${qs ? "?" + qs : ""}`;
    return {
      url,
    };
  }

  /**
   * Extracts an array from API responses that may be either a plain array
   * or a paginated wrapper like { data: [...], meta: {...} }.
   */
  static normalizeArray<T>(response: unknown): T[] {
    if (Array.isArray(response)) {
      return response;
    }
    if (
      response &&
      typeof response === "object" &&
      "data" in (response as object)
    ) {
      const arr = (response as Record<string, unknown>).data;
      if (Array.isArray(arr)) {
        return arr as T[];
      }
    }
    return [];
  }
}
