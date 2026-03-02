import { SpicaClient } from "./client.js";
import type { FunctionLog } from "../models/types.js";

const client = SpicaClient.instance;

export interface LogFilters {
  limit?: number;
  skip?: number;
  begin?: string;
  end?: string;
  functions?: string[];
  channel?: string;
  levels?: string[];
  content?: string;
}

export async function listFunctionLogs(
  filters?: LogFilters,
): Promise<FunctionLog[]> {
  const query = new URLSearchParams();
  if (filters?.limit !== undefined) {
    query.set("limit", String(filters.limit));
  }
  if (filters?.skip !== undefined) {
    query.set("skip", String(filters.skip));
  }
  if (filters?.begin) {
    query.set("begin", filters.begin);
  }
  if (filters?.end) {
    query.set("end", filters.end);
  }
  if (filters?.functions?.length) {
    for (const f of filters.functions) {
      query.append("functions", f);
    }
  }
  if (filters?.channel) {
    query.set("channel", filters.channel);
  }
  if (filters?.levels?.length) {
    for (const l of filters.levels) {
      query.append("levels", l);
    }
  }
  if (filters?.content) {
    query.set("content", filters.content);
  }
  const qs = query.toString();
  return client.get<FunctionLog[]>(`/function-logs${qs ? "?" + qs : ""}`);
}

export async function clearFunctionLogs(functionId: string): Promise<void> {
  return client.delete(`/function-logs/${functionId}`);
}
