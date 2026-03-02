import { SpicaClient } from "./client.js";
import type { LoginCredentials, TokenResponse } from "../models/types.js";

const client = SpicaClient.instance;

/**
 * Login with identifier and password to obtain a JWT.
 */
export async function login(
  baseUrl: string,
  identifier: string,
  password: string,
  expires: number = 86400,
): Promise<TokenResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/passport/identify`;
  const body: LoginCredentials = { identifier, password, expires };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json: unknown = await resp.json();
  if (!resp.ok) {
    const errBody = json as Record<string, unknown>;
    throw new Error((errBody.message as string) || "Login failed");
  }

  return json as TokenResponse;
}

/**
 * Validate an API key by making an authenticated request.
 */
export async function validateApiKey(
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, "")}/bucket`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `APIKEY ${apiKey}` },
  });
  return resp.ok || resp.status === 403;
}
