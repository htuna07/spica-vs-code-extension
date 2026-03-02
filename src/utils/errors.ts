import * as vscode from "vscode";
import type { ErrorResponse } from "../models/types.js";

export class SpicaApiError extends Error {
  public readonly statusCode: number;
  public readonly apiError?: string;

  constructor(statusCode: number, message: string, apiError?: string) {
    super(message);
    this.name = "SpicaApiError";
    this.statusCode = statusCode;
    this.apiError = apiError;
  }

  static fromResponse(body: ErrorResponse): SpicaApiError {
    return new SpicaApiError(body.statusCode, body.message, body.error);
  }
}

/**
 * Show a VS Code error notification with readable API error details.
 */
export function showApiError(err: unknown, prefix?: string): void {
  let msg: string;
  if (err instanceof SpicaApiError) {
    msg = `${err.statusCode}: ${err.message}`;
  } else if (err instanceof Error) {
    msg = err.message;
  } else {
    msg = String(err);
  }
  vscode.window.showErrorMessage(prefix ? `${prefix} — ${msg}` : msg);
}

/**
 * Show a success notification.
 */
export function showSuccess(message: string): void {
  vscode.window.showInformationMessage(message);
}

/**
 * Check whether an error is a 401 Unauthorized.
 */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof SpicaApiError && err.statusCode === 401;
}
