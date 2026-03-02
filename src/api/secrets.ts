import { SpicaClient } from "./client.js";
import type { Secret, SecretInput } from "../models/types.js";

const client = SpicaClient.instance;

export async function listSecrets(): Promise<Secret[]> {
  const result = await client.get<unknown>("/secret");
  return SpicaClient.normalizeArray<Secret>(result);
}

export async function getSecret(id: string): Promise<Secret> {
  return client.get<Secret>(`/secret/${id}`);
}

export async function createSecret(input: SecretInput): Promise<Secret> {
  return client.post<Secret>("/secret", input);
}

export async function updateSecret(
  id: string,
  input: SecretInput,
): Promise<Secret> {
  return client.put<Secret>(`/secret/${id}`, input);
}

export async function deleteSecret(id: string): Promise<void> {
  return client.delete(`/secret/${id}`);
}
