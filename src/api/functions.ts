import { SpicaClient } from "./client.js";
import type {
  SpicaFunction,
  FunctionInput,
  FunctionInformation,
} from "../models/types.js";

const client = SpicaClient.instance;

// ── Function Information (dynamic) ──────────────────────────────────

export async function getFunctionInformation(): Promise<FunctionInformation> {
  return client.get<FunctionInformation>("/function/information");
}

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
