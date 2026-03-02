import { SpicaClient } from "./client.js";
import type { EnvVar, EnvVarInput } from "../models/types.js";

const client = SpicaClient.instance;

export async function listEnvVars(): Promise<EnvVar[]> {
  const result = await client.get<unknown>("/env-var");
  return SpicaClient.normalizeArray<EnvVar>(result);
}

export async function getEnvVar(id: string): Promise<EnvVar> {
  return client.get<EnvVar>(`/env-var/${id}`);
}

export async function createEnvVar(input: EnvVarInput): Promise<EnvVar> {
  return client.post<EnvVar>("/env-var", input);
}

export async function updateEnvVar(
  id: string,
  input: EnvVarInput,
): Promise<EnvVar> {
  return client.put<EnvVar>(`/env-var/${id}`, input);
}

export async function deleteEnvVar(id: string): Promise<void> {
  return client.delete(`/env-var/${id}`);
}
