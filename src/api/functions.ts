import { SpicaClient } from "./client.js";
import type { SpicaFunction, FunctionInput } from "../models/types.js";

const client = SpicaClient.instance;

export async function listFunctions(): Promise<SpicaFunction[]> {
  const result = await client.get<unknown>("/function");
  return SpicaClient.normalizeArray<SpicaFunction>(result);
}

export async function getFunction(id: string): Promise<SpicaFunction> {
  return client.get<SpicaFunction>(`/function/${id}`);
}

export async function createFunction(
  input: FunctionInput,
): Promise<SpicaFunction> {
  return client.post<SpicaFunction>("/function", input);
}

export async function replaceFunction(
  id: string,
  input: FunctionInput,
): Promise<SpicaFunction> {
  return client.put<SpicaFunction>(`/function/${id}`, input);
}

export async function patchFunction(
  id: string,
  patch: { category?: string; order?: number },
): Promise<SpicaFunction> {
  return client.patch<SpicaFunction>(`/function/${id}`, patch);
}

export async function deleteFunction(id: string): Promise<void> {
  return client.delete(`/function/${id}`);
}

// ── Source code ──────────────────────────────────────────────────────

export async function getFunctionIndex(id: string): Promise<{ index: string }> {
  return client.get<{ index: string }>(`/function/${id}/index`);
}

export async function updateFunctionIndex(
  id: string,
  code: string,
): Promise<void> {
  return client.post(`/function/${id}/index`, { index: code });
}

// ── Dependencies ────────────────────────────────────────────────────

export async function getFunctionDependencies(id: string): Promise<unknown> {
  return client.get<unknown>(`/function/${id}/dependencies`);
}

export async function addFunctionDependencies(
  id: string,
  names: string[],
): Promise<Record<string, string>> {
  return client.post<Record<string, string>>(`/function/${id}/dependencies`, {
    name: names,
  });
}

export async function removeFunctionDependency(
  id: string,
  name: string,
): Promise<void> {
  return client.delete(`/function/${id}/dependencies/${name}`);
}

// ── Env Var & Secret injection ──────────────────────────────────────

export async function injectEnvVar(
  functionId: string,
  envVarId: string,
): Promise<SpicaFunction> {
  return client.put<SpicaFunction>(
    `/function/${functionId}/env-var/${envVarId}`,
  );
}

export async function ejectEnvVar(
  functionId: string,
  envVarId: string,
): Promise<void> {
  return client.delete(`/function/${functionId}/env-var/${envVarId}`);
}

export async function injectSecret(
  functionId: string,
  secretId: string,
): Promise<SpicaFunction> {
  return client.put<SpicaFunction>(
    `/function/${functionId}/secret/${secretId}`,
  );
}

export async function ejectSecret(
  functionId: string,
  secretId: string,
): Promise<void> {
  return client.delete(`/function/${functionId}/secret/${secretId}`);
}
