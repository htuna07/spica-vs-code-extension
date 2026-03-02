import { SpicaClient } from "./client.js";
import type { BucketDocument, PaginatedResponse } from "../models/types.js";

const client = SpicaClient.instance;

export interface ListDataParams {
  limit?: number;
  skip?: number;
  sort?: Record<string, 1 | -1>;
  paginate?: boolean;
  relation?: boolean;
  localize?: boolean;
  filter?: string;
}

export async function listBucketData(
  bucketId: string,
  params?: ListDataParams,
): Promise<BucketDocument[]> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params?.skip !== undefined) {
    query.set("skip", String(params.skip));
  }
  if (params?.paginate !== undefined) {
    query.set("paginate", String(params.paginate));
  }
  if (params?.relation !== undefined) {
    query.set("relation", String(params.relation));
  }
  if (params?.localize !== undefined) {
    query.set("localize", String(params.localize));
  }
  if (params?.filter) {
    query.set("filter", params.filter);
  }
  const qs = query.toString();
  const path = `/bucket/${bucketId}/data${qs ? "?" + qs : ""}`;
  const result = await client.get<unknown>(path);
  return SpicaClient.normalizeArray<BucketDocument>(result);
}

export async function getBucketDocument(
  bucketId: string,
  documentId: string,
): Promise<BucketDocument> {
  return client.get<BucketDocument>(`/bucket/${bucketId}/data/${documentId}`);
}

export async function insertBucketData(
  bucketId: string,
  doc: Record<string, unknown>,
): Promise<BucketDocument> {
  return client.post<BucketDocument>(`/bucket/${bucketId}/data`, doc);
}

export async function replaceBucketDocument(
  bucketId: string,
  documentId: string,
  doc: Record<string, unknown>,
): Promise<BucketDocument> {
  return client.put<BucketDocument>(
    `/bucket/${bucketId}/data/${documentId}`,
    doc,
  );
}

export async function patchBucketDocument(
  bucketId: string,
  documentId: string,
  patch: Record<string, unknown>,
): Promise<BucketDocument> {
  return client.patch<BucketDocument>(
    `/bucket/${bucketId}/data/${documentId}`,
    patch,
  );
}

export async function deleteBucketDocument(
  bucketId: string,
  documentId: string,
): Promise<void> {
  return client.delete(`/bucket/${bucketId}/data/${documentId}`);
}
