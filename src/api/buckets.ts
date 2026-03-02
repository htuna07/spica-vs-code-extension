import { SpicaClient } from "./client.js";
import type { Bucket, BucketInput } from "../models/types.js";

const client = SpicaClient.instance;

export async function listBuckets(): Promise<Bucket[]> {
  const result = await client.get<unknown>("/bucket");
  return SpicaClient.normalizeArray<Bucket>(result);
}

export async function getBucket(id: string): Promise<Bucket> {
  return client.get<Bucket>(`/bucket/${id}`);
}

export async function createBucket(input: BucketInput): Promise<Bucket> {
  return client.post<Bucket>("/bucket", input);
}

export async function replaceBucket(
  id: string,
  input: BucketInput,
): Promise<Bucket> {
  return client.put<Bucket>(`/bucket/${id}`, input);
}

export async function patchBucket(
  id: string,
  patch: { category?: string; order?: number },
): Promise<Bucket> {
  return client.patch<Bucket>(`/bucket/${id}`, patch);
}

export async function deleteBucket(id: string): Promise<void> {
  return client.delete(`/bucket/${id}`);
}
