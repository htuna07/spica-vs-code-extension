import * as vscode from "vscode";
import { SPICA_SCHEME, ModuleType } from "../utils/constants.js";
import { showApiError, showSuccess } from "../utils/errors.js";

// API imports
import { getBucket, replaceBucket } from "../api/buckets.js";
import {
  getBucketDocument,
  replaceBucketDocument,
  insertBucketData,
} from "../api/bucket-data.js";
import {
  getFunction,
  replaceFunction,
  getFunctionIndex,
  updateFunctionIndex,
} from "../api/functions.js";
import { getPolicy, updatePolicy } from "../api/policies.js";
import { getEnvVar, updateEnvVar } from "../api/env-vars.js";
import { getSecret, updateSecret } from "../api/secrets.js";

/**
 * URI format:
 *   spica:/buckets/{id}.json
 *   spica:/buckets/{bucketId}/data/{docId}.json
 *   spica:/functions/{id}.json
 *   spica:/functions/{id}/index.ts
 *   spica:/policies/{id}.json
 *   spica:/env-vars/{id}.json
 *   spica:/secrets/{id}.json
 */

interface ParsedUri {
  moduleType: ModuleType;
  resourceId: string;
  subKind?: "data" | "index" | "dependencies";
  childId?: string;
}

function parseUri(uri: vscode.Uri): ParsedUri {
  // path looks like: /buckets/{id}.json  or  /buckets/{bid}/data/{did}.json
  const segments = uri.path.split("/").filter(Boolean);

  const modStr = segments[0];
  let moduleType: ModuleType;
  switch (modStr) {
    case "buckets":
      moduleType = ModuleType.Buckets;
      break;
    case "functions":
      moduleType = ModuleType.Functions;
      break;
    case "policies":
      moduleType = ModuleType.Policies;
      break;
    case "env-vars":
      moduleType = ModuleType.EnvVars;
      break;
    case "secrets":
      moduleType = ModuleType.Secrets;
      break;
    default:
      throw new Error(`Unknown module: ${modStr}`);
  }

  const stripExt = (s: string) => s.replace(/\.(json|ts|js)$/, "");

  if (segments.length === 2) {
    return { moduleType, resourceId: stripExt(segments[1]) };
  }

  if (
    segments.length === 3 &&
    (segments[2] === "index.ts" || segments[2] === "index.js")
  ) {
    return {
      moduleType,
      resourceId: stripExt(segments[1]),
      subKind: "index",
    };
  }

  if (segments.length === 4 && segments[2] === "data") {
    return {
      moduleType,
      resourceId: segments[1],
      subKind: "data",
      childId: stripExt(segments[3]),
    };
  }

  throw new Error(`Cannot parse URI: ${uri.toString()}`);
}

export class SpicaFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  // Cache for file contents to allow stat() to work
  private _cache = new Map<string, Uint8Array>();

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const cached = this._cache.get(uri.toString());
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: cached?.length ?? 0,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const parsed = parseUri(uri);
      const content = await this.fetchContent(parsed);
      const encoded = new TextEncoder().encode(content);
      this._cache.set(uri.toString(), encoded);
      return encoded;
    } catch (err) {
      showApiError(err, "Failed to read resource");
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    try {
      const parsed = parseUri(uri);
      const text = new TextDecoder().decode(content);
      await this.saveContent(parsed, text);
      this._cache.set(uri.toString(), content);
      showSuccess("Resource saved successfully");
    } catch (err) {
      showApiError(err, "Failed to save resource");
      throw vscode.FileSystemError.NoPermissions(uri);
    }
  }

  async delete(uri: vscode.Uri): Promise<void> {
    this._cache.delete(uri.toString());
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Rename not supported");
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async fetchContent(parsed: ParsedUri): Promise<string> {
    switch (parsed.moduleType) {
      case ModuleType.Buckets: {
        if (parsed.subKind === "data" && parsed.childId) {
          // New document: childId starts with "new-"
          if (parsed.childId.startsWith("new-")) {
            return JSON.stringify({}, null, 2);
          }
          const doc = await getBucketDocument(
            parsed.resourceId,
            parsed.childId,
          );
          return JSON.stringify(doc, null, 2);
        }
        const bucket = await getBucket(parsed.resourceId);
        return JSON.stringify(bucket, null, 2);
      }
      case ModuleType.Functions: {
        if (parsed.subKind === "index") {
          const { index } = await getFunctionIndex(parsed.resourceId);
          return index || "";
        }
        const func = await getFunction(parsed.resourceId);
        return JSON.stringify(func, null, 2);
      }
      case ModuleType.Policies: {
        const policy = await getPolicy(parsed.resourceId);
        return JSON.stringify(policy, null, 2);
      }
      case ModuleType.EnvVars: {
        const envVar = await getEnvVar(parsed.resourceId);
        return JSON.stringify(envVar, null, 2);
      }
      case ModuleType.Secrets: {
        const secret = await getSecret(parsed.resourceId);
        return JSON.stringify(secret, null, 2);
      }
      default:
        throw new Error(`Unknown module type: ${parsed.moduleType}`);
    }
  }

  private async saveContent(parsed: ParsedUri, text: string): Promise<void> {
    switch (parsed.moduleType) {
      case ModuleType.Buckets: {
        if (parsed.subKind === "data" && parsed.childId) {
          const doc = JSON.parse(text);
          // New document: childId starts with "new-" → insert
          if (parsed.childId.startsWith("new-")) {
            await insertBucketData(parsed.resourceId, doc);
            return;
          }
          await replaceBucketDocument(parsed.resourceId, parsed.childId, doc);
          return;
        }
        const bucketData = JSON.parse(text);
        const { _id, ...input } = bucketData;
        await replaceBucket(parsed.resourceId, input);
        return;
      }
      case ModuleType.Functions: {
        if (parsed.subKind === "index") {
          await updateFunctionIndex(parsed.resourceId, text);
          return;
        }
        const funcData = JSON.parse(text);
        const { _id, ...input } = funcData;
        await replaceFunction(parsed.resourceId, input);
        return;
      }
      case ModuleType.Policies: {
        const policyData = JSON.parse(text);
        const { _id, ...input } = policyData;
        await updatePolicy(parsed.resourceId, input);
        return;
      }
      case ModuleType.EnvVars: {
        const envData = JSON.parse(text);
        const { _id, ...input } = envData;
        await updateEnvVar(parsed.resourceId, input);
        return;
      }
      case ModuleType.Secrets: {
        const secretData = JSON.parse(text);
        const { _id, ...input } = secretData;
        await updateSecret(parsed.resourceId, input);
        return;
      }
    }
  }

  /**
   * Build a spica: URI for a given resource.
   */
  static buildUri(
    moduleType: ModuleType,
    resourceId: string,
    subKind?: string,
    childId?: string,
  ): vscode.Uri {
    let modPath: string;
    switch (moduleType) {
      case ModuleType.Buckets:
        modPath = "buckets";
        break;
      case ModuleType.Functions:
        modPath = "functions";
        break;
      case ModuleType.Policies:
        modPath = "policies";
        break;
    }

    if (subKind === "source" || subKind === "index") {
      const ext = childId === "javascript" ? "js" : "ts";
      return vscode.Uri.parse(
        `${SPICA_SCHEME}:/${modPath}/${resourceId}/index.${ext}`,
      );
    }

    if (subKind === "data" && childId) {
      return vscode.Uri.parse(
        `${SPICA_SCHEME}:/${modPath}/${resourceId}/data/${childId}.json`,
      );
    }

    if (subKind === "document" && childId) {
      return vscode.Uri.parse(
        `${SPICA_SCHEME}:/${modPath}/${resourceId}/data/${childId}.json`,
      );
    }

    return vscode.Uri.parse(`${SPICA_SCHEME}:/${modPath}/${resourceId}.json`);
  }
}
