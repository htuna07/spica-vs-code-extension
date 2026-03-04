import * as vscode from "vscode";
import { SpicaTreeItem } from "../models/tree-node.js";
import { streamFunctionLogs, type LogStream } from "../api/function-logs.js";
import { showApiError } from "../utils/errors.js";
import type { FunctionLog } from "../models/types.js";

const LOG_LEVEL_NAMES: Record<number, string> = {
  0: "ERROR",
  1: "WARN",
  2: "INFO",
  3: "DEBUG",
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
  const level = LOG_LEVEL_NAMES[log.level] ?? `L${log.level}`;
  return `[${ts}] [${level}] ${log.content}`;
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
      { functions: [resourceId!] },
      {
        onInitialBatch: () => {
          channel.clear();
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
