import * as vscode from "vscode";
import { SpicaTreeItem } from "../models/tree-node.js";
import { listFunctionLogs, clearFunctionLogs } from "../api/function-logs.js";
import { showApiError, showSuccess } from "../utils/errors.js";
import type { FunctionLog } from "../models/types.js";

const LOG_LEVEL_NAMES: Record<number, string> = {
  0: "ERROR",
  1: "WARN",
  2: "INFO",
  3: "DEBUG",
};

// Keep a map of output channels by function id
const channels = new Map<string, vscode.OutputChannel>();

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
 * Fetch and display logs for a function in an OutputChannel.
 */
export async function viewLogsCommand(item: SpicaTreeItem): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { resourceId, label } = item.data;

  try {
    const logs = await listFunctionLogs({
      functions: [resourceId!],
      limit: 200,
    });

    const channel = getOrCreateChannel(resourceId!, label);
    channel.clear();

    if (logs.length === 0) {
      channel.appendLine("No logs found for this function.");
    } else {
      // Show newest last
      const sorted = [...logs].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      for (const log of sorted) {
        channel.appendLine(formatLog(log));
      }
    }

    channel.show(true);
  } catch (err) {
    showApiError(err, "Failed to fetch logs");
  }
}

/**
 * Dispose all log output channels.
 */
export function disposeLogChannels(): void {
  for (const channel of channels.values()) {
    channel.dispose();
  }
  channels.clear();
}
