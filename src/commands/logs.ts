import * as vscode from "vscode";
import { SpicaTreeItem } from "../models/tree-node.js";
import { streamFunctionLogs, type LogStream } from "../api/function-logs.js";
import { listFunctions } from "../api/functions.js";
import { showApiError } from "../utils/errors.js";
import type { FunctionLog } from "../models/types.js";

const LOG_LEVEL_ICONS: Record<number, string> = {
  0: "🐛",
  1: "💬",
  2: "ℹ️",
  3: "⚠️",
  4: "❌",
};

// Keep a map of output channels by function id
const channels = new Map<string, vscode.OutputChannel>();
// Track active real-time streams by function id
const activeStreams = new Map<string, LogStream>();

function getOrCreateChannel(
  functionId: string,
  functionName: string,
): vscode.OutputChannel {
  let channel = channels.get(functionId);
  if (!channel) {
    channel = vscode.window.createOutputChannel(`Spica: ${functionName}`);
    channels.set(functionId, channel);
  }
  return channel;
}

function formatLog(log: FunctionLog): string {
  const ts = new Date(log.created_at).toLocaleString();
  const level = LOG_LEVEL_ICONS[log.level] ?? `L${log.level}`;
  return `[${ts}] ${level} ${log.content}`;
}
function formatLogWithName(log: FunctionLog, fnName: string): string {
  const ts = new Date(log.created_at).toLocaleString();
  const icon = LOG_LEVEL_ICONS[log.level] ?? `L${log.level}`;
  return `[${ts}] [${fnName}] ${icon} ${log.content}`;
}
/**
 * Stream real-time logs for a function in an OutputChannel.
 * The WebSocket delivers an initial batch, then incremental inserts/updates/deletes.
 * If a stream is already active for the function it is stopped and restarted.
 */
export async function viewLogsCommand(item: SpicaTreeItem): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { resourceId, label } = item.data;

  // Stop any existing stream for this function
  const existing = activeStreams.get(resourceId!);
  if (existing) {
    existing.dispose();
    activeStreams.delete(resourceId!);
  }

  const channel = getOrCreateChannel(resourceId!, label);
  channel.clear();
  channel.show(true);
  channel.appendLine("Connecting to log stream…");

  try {
    const stream = streamFunctionLogs(
      {
        functions: [resourceId!],
        begin: new Date().toISOString(), // only stream new logs
      },
      {
        onInitialBatch: (logs) => {
          channel.clear();
          const sorted = logs
            .slice()
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          for (const log of sorted) {
            channel.appendLine(formatLog(log));
          }
        },

        onInsert: (log) => {
          channel.appendLine(formatLog(log));
        },

        onError: (err) => {
          channel.appendLine(`[Stream error] ${err.message}`);
        },

        onClose: () => {
          activeStreams.delete(resourceId!);
        },
      },
    );

    activeStreams.set(resourceId!, stream);
  } catch (err) {
    showApiError(err, "Failed to start log stream");
  }
}

const ALL_LOGS_CHANNEL_KEY = "__all__";

/**
 * Stream all function logs (no function filter) into a single output channel.
 * Log lines include the function name between the timestamp and the level.
 */
export async function streamAllLogsCommand(): Promise<void> {
  // Stop any existing all-logs stream
  const existing = activeStreams.get(ALL_LOGS_CHANNEL_KEY);
  if (existing) {
    existing.dispose();
    activeStreams.delete(ALL_LOGS_CHANNEL_KEY);
  }

  const channel = getOrCreateChannel(ALL_LOGS_CHANNEL_KEY, "All Functions");
  channel.clear();
  channel.show(true);

  // Build a function id → name map for formatting
  let fnNames = new Map<string, string>();
  try {
    const funcs = await listFunctions();
    for (const f of funcs) {
      fnNames.set(f._id, f.name || f._id);
    }
  } catch {
    // Non-fatal; fall back to using the function id as the name
  }

  try {
    const stream = streamFunctionLogs(
      {
        begin: new Date().toISOString(), // only stream new logs
      },
      {
        onInitialBatch: (logs) => {
          channel.clear();
          const sorted = logs
            .slice()
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          for (const log of sorted) {
            const name = fnNames.get(log.function) ?? log.function;
            channel.appendLine(formatLogWithName(log, name));
          }
        },

        onInsert: (log) => {
          const name = fnNames.get(log.function) ?? log.function;
          channel.appendLine(formatLogWithName(log, name));
        },

        onError: (err) => {
          channel.appendLine(`[Stream error] ${err.message}`);
        },

        onClose: () => {
          activeStreams.delete(ALL_LOGS_CHANNEL_KEY);
        },
      },
    );

    activeStreams.set(ALL_LOGS_CHANNEL_KEY, stream);
  } catch (err) {
    showApiError(err, "Failed to start log stream");
  }
}

/**
 * Dispose all log output channels and stop all active streams.
 */
export function disposeLogChannels(): void {
  for (const stream of activeStreams.values()) {
    stream.dispose();
  }
  activeStreams.clear();

  for (const channel of channels.values()) {
    channel.dispose();
  }
  channels.clear();
}
