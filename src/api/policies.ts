import { SpicaClient } from "./client.js";
import type { Policy, PolicyInput } from "../models/types.js";

const client = SpicaClient.instance;

export async function listPolicies(): Promise<Policy[]> {
  const filter = encodeURIComponent(JSON.stringify({ system: false }));
  const result = await client.get<unknown>(`/passport/policy?filter=${filter}`);
  return SpicaClient.normalizeArray<Policy>(result);
}

export async function getPolicy(id: string): Promise<Policy> {
  return client.get<Policy>(`/passport/policy/${id}`);
}

export async function createPolicy(input: PolicyInput): Promise<Policy> {
  return client.post<Policy>("/passport/policy", input);
}

export async function updatePolicy(
  id: string,
  input: PolicyInput,
): Promise<Policy> {
  return client.put<Policy>(`/passport/policy/${id}`, input);
}

export async function deletePolicy(id: string): Promise<void> {
  return client.delete(`/passport/policy/${id}`);
}
