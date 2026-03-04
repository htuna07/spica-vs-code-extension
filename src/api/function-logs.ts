import WebSocket from "ws";
import { SpicaClient } from "./client.js";
import type { FunctionLog } from "../models/types.js";

const client = SpicaClient.instance;

// ── Spica real-time chunk protocol ────────────────────────────────────────

export enum ChunkKind {
  Error = -1,
  Initial = 0,
  EndOfInitial = 1,
  Insert = 2,
  Delete = 3,
  Expunge = 4,
  Update = 5,
  Replace = 6,
  Order = 7,
  Response = 8,
}

export enum SequenceKind {
  Delete = 0,
  Substitute = 1,
  Insert = 2,
}

export interface Sequence {
  kind: SequenceKind;
  item: string;
  at: number;
  with?: string;
}

export interface StreamChunk<T> {
  kind: ChunkKind;
  document?: T;
  sequence?: Sequence[];
}

/**
 * Ordered set that mirrors the server-side dataset.
 * Maintains insertion order and supports the Spica sequence-based reordering.
 */
class IterableSet<T extends { _id: string }> implements Iterable<T> {
  ids: string[] = [];
  dataset = new Map<string, T>();

  order(sequences: Sequence[]): void {
    if (!sequences) {
      return;
    }
    const deletedIds = new Set<string>();
    for (const seq of sequences) {
      switch (seq.kind) {
        case SequenceKind.Substitute:
          this.ids[seq.at] = seq.with!;
          break;
        case SequenceKind.Insert:
          this.ids.splice(seq.at, 0, seq.item);
          break;
        case SequenceKind.Delete:
          this.ids.splice(seq.at, 1);
          deletedIds.add(seq.item);
          break;
      }
    }
    for (const id of deletedIds) {
      if (this.ids.indexOf(id) === -1) {
        this.dataset.delete(id);
      }
    }
  }

  set(id: string, value: T): void {
    if (!this.dataset.has(id)) {
      this.ids.push(id);
    }
    this.dataset.set(id, value);
  }

  delete(id: string, index?: number): void {
    index = index ?? this.ids.indexOf(id);
    if (index !== -1) {
      this.ids.splice(index, 1);
    }
    this.dataset.delete(id);
  }

  toArray(): T[] {
    return this.ids
      .map((id) => this.dataset.get(id))
      .filter((v): v is T => v !== undefined);
  }

  [Symbol.iterator](): Iterator<T> {
    let i = 0;
    return {
      next: () => {
        let value: T | undefined;
        if (i < this.ids.length) {
          value = this.dataset.get(this.ids[i]);
        }
        return { value: value as T, done: (i += 1) > this.ids.length };
      },
    };
  }
}

// ── Filters & HTTP fetching ───────────────────────────────────────────────

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

function buildLogQuery(filters?: LogFilters): URLSearchParams {
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
  return query;
}

export async function listFunctionLogs(
  filters?: LogFilters,
): Promise<FunctionLog[]> {
  const query = buildLogQuery(filters);
  const qs = query.toString();
  return client.get<FunctionLog[]>(`/function-logs${qs ? "?" + qs : ""}`);
}

// ── Real-time streaming ──────────────────────────────────────────────────

export interface LogStream {
  dispose: () => void;
}

export interface LogStreamCallbacks {
  /** Called once after all Initial chunks have been received. */
  onInitialBatch: (logs: FunctionLog[]) => void;
  /** Called when a new log is inserted. */
  onInsert: (log: FunctionLog) => void;
  /** Called on WebSocket or protocol error. */
  onError: (err: Error) => void;
  /** Called when the WebSocket connection closes. */
  onClose: () => void;
}

/**
 * Opens a WebSocket connection to stream function logs in real-time.
 *
 * The Spica API uses a custom chunk protocol:
 * - Initial + EndOfInitial: delivers the initial dataset
 * - Insert/Update/Replace/Delete/Expunge/Order: incremental mutations
 *
 * Returns a disposable that closes the connection.
 */
export function streamFunctionLogs(
  filters: LogFilters,
  callbacks: LogStreamCallbacks,
): LogStream {
  const query = buildLogQuery(filters);
  const { url } = client.getWsConnectionOptions("/function-logs", query);

  const ws = new WebSocket(url);
  const data = new IterableSet<FunctionLog>();
  let disposed = false;
  let initialPhase = true;
  const RECONNECT_CODE = 1006;

  function handleChunk(chunk: StreamChunk<FunctionLog>): void {
    if (chunk.kind === ChunkKind.Response) {
      return; // protocol-level ack, ignore
    }

    switch (chunk.kind) {
      case ChunkKind.Initial:
        if (chunk.document) {
          data.set(chunk.document._id, chunk.document);
        }
        break;

      case ChunkKind.EndOfInitial:
        initialPhase = false;
        callbacks.onInitialBatch(data.toArray());
        break;

      case ChunkKind.Insert:
        if (chunk.document) {
          data.set(chunk.document._id, chunk.document);
          if (!initialPhase) {
            callbacks.onInsert(chunk.document);
          }
        }
        break;

      case ChunkKind.Update:
      case ChunkKind.Replace:
        // editing logs is not a common scenario
        break;

      case ChunkKind.Delete:
      case ChunkKind.Expunge:
        // deleted logs could stay in the view
        break;

      case ChunkKind.Order:
        if (chunk.sequence) {
          data.order(chunk.sequence);
        }
        break;

      case ChunkKind.Error: {
        const errPayload = { ...chunk };
        delete (errPayload as Record<string, unknown>).kind;
        callbacks.onError(new Error(JSON.stringify(errPayload)));
        break;
      }
    }
  }

  ws.on("message", (raw) => {
    try {
      const chunk = JSON.parse(raw.toString()) as StreamChunk<FunctionLog>;
      handleChunk(chunk);
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("error", (err) => {
    if (!disposed) {
      callbacks.onError(err);
    }
  });

  ws.on("close", (code) => {
    if (!disposed) {
      if (code === RECONNECT_CODE) {
        // Abnormal close — the original RxJS code retries on 1006.
        // Re-open the stream automatically.
        callbacks.onError(
          new Error(`WebSocket closed with code ${code}, reconnecting…`),
        );
        const retryStream = streamFunctionLogs(filters, callbacks);
        disposeInner = retryStream.dispose;
        return;
      }
      callbacks.onClose();
    }
  });

  let disposeInner: (() => void) | undefined;

  return {
    dispose: () => {
      disposed = true;
      ws.removeAllListeners();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
      disposeInner?.();
    },
  };
}

export async function clearFunctionLogs(functionId: string): Promise<void> {
  return client.delete(`/function-logs/${functionId}`);
}
