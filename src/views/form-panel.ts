import * as vscode from "vscode";
import { ModuleType } from "../utils/constants.js";
import { SpicaTreeItem, NodeType } from "../models/tree-node.js";
import { SpicaTreeProvider } from "../providers/tree-provider.js";
import { showApiError, showSuccess } from "../utils/errors.js";

// API imports
import { createBucket, replaceBucket, getBucket } from "../api/buckets.js";
import { insertBucketData } from "../api/bucket-data.js";
import {
  createFunction,
  replaceFunction,
  getFunction,
  getFunctionInformation,
  addFunctionDependencies,
  updateFunctionIndex,
} from "../api/functions.js";
import { createPolicy, updatePolicy, getPolicy } from "../api/policies.js";
import { SpicaFileSystemProvider } from "../providers/file-system.js";

import type {
  FunctionInformation,
  FunctionEnqueuer,
  FunctionInput,
} from "../models/types.js";

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Open a webview form for creating a new resource.
 */
export async function addResourceCommand(
  item: SpicaTreeItem,
  treeProvider: SpicaTreeProvider,
  extensionUri: vscode.Uri,
): Promise<void> {
  if (!item?.data) {
    return;
  }

  const { moduleType, subKind, resourceId } = item.data;

  // Dependencies sub-module → quick input instead of webview
  if (subKind === "dependencies" && resourceId) {
    await addDependencyQuickInput(resourceId, treeProvider);
    return;
  }

  // Environment variables sub-module → two-step quick input
  if (subKind === "environment" && resourceId) {
    await addEnvVarQuickInput(resourceId, treeProvider);
    return;
  }

  // Bucket data → open JSON editor for new document
  if (
    moduleType === ModuleType.Buckets &&
    item.data.nodeType === NodeType.Resource &&
    resourceId
  ) {
    await openNewBucketDataEditor(resourceId);
    return;
  }

  // Standard module-level add
  await openResourceForm(moduleType, treeProvider, false);
}

/**
 * Open a webview form for editing an existing resource (Policies, Buckets, Functions).
 * For other types the caller should fall back to raw JSON editing.
 */
export async function editResourceFormCommand(
  item: SpicaTreeItem,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { moduleType, resourceId } = item.data;

  // Only Policies, Buckets, Functions get the structured edit form
  if (
    moduleType === ModuleType.Policies ||
    moduleType === ModuleType.Buckets ||
    moduleType === ModuleType.Functions
  ) {
    await openResourceForm(moduleType, treeProvider, true, resourceId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Core form opener
// ─────────────────────────────────────────────────────────────────────

async function openResourceForm(
  moduleType: ModuleType,
  treeProvider: SpicaTreeProvider,
  editMode: boolean,
  resourceId?: string,
): Promise<void> {
  let existingData: Record<string, unknown> | undefined;
  let functionInfo: FunctionInformation | undefined;

  // Load function information for dynamic trigger config
  if (moduleType === ModuleType.Functions) {
    try {
      functionInfo = await getFunctionInformation();
    } catch {
      vscode.window.showWarningMessage(
        "Could not load function information from server. Using static defaults.",
      );
    }
  }

  // Load existing data for edit mode
  if (editMode && resourceId) {
    try {
      switch (moduleType) {
        case ModuleType.Policies:
          existingData = (await getPolicy(resourceId)) as unknown as Record<
            string,
            unknown
          >;
          break;
        case ModuleType.Buckets:
          existingData = (await getBucket(resourceId)) as unknown as Record<
            string,
            unknown
          >;
          break;
        case ModuleType.Functions:
          existingData = (await getFunction(resourceId)) as unknown as Record<
            string,
            unknown
          >;
          break;
      }
    } catch (err) {
      showApiError(err, "Failed to load resource for editing");
      return;
    }
  }

  const formTitle = getFormTitle(moduleType);
  if (!formTitle) {
    return;
  }

  const panelTitle = editMode ? `Edit ${formTitle}` : `New ${formTitle}`;
  const submitLabel = editMode ? "Save" : "Create";

  const panel = vscode.window.createWebviewPanel(
    "spicaForm",
    panelTitle,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildStructuredFormHtml(
    panelTitle,
    submitLabel,
    moduleType,
    functionInfo,
    existingData,
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "submit") {
      try {
        if (editMode && resourceId) {
          await updateResource(moduleType, resourceId, msg.data, existingData);
          showSuccess(`${formTitle} updated successfully`);
        } else {
          await createResource(moduleType, msg.data);
          showSuccess(`${formTitle} created successfully`);
        }
        treeProvider.refresh();
        panel.dispose();
      } catch (err) {
        showApiError(
          err,
          `Failed to ${editMode ? "update" : "create"} ${formTitle}`,
        );
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Dependency quick input
// ─────────────────────────────────────────────────────────────────────

async function addDependencyQuickInput(
  functionId: string,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Add Dependencies",
    prompt: "Enter package names separated by spaces (e.g., axios lodash)",
    placeHolder: "axios lodash moment",
    ignoreFocusOut: true,
  });

  if (!input?.trim()) {
    return;
  }

  const names = input.trim().split(/\s+/);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Installing dependencies…",
      },
      () => addFunctionDependencies(functionId, names),
    );
    showSuccess(`Dependencies installed: ${names.join(", ")}`);
    treeProvider.refresh();
  } catch (err) {
    showApiError(err, "Failed to install dependencies");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Environment variable quick input (two-step: key then value)
// ─────────────────────────────────────────────────────────────────────

async function addEnvVarQuickInput(
  functionId: string,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: "Add Environment Variable (1/2)",
    prompt: "Enter the variable name (key)",
    placeHolder: "MY_ENV_VAR",
    ignoreFocusOut: true,
  });

  if (!key?.trim()) {
    return;
  }

  const value = await vscode.window.showInputBox({
    title: "Add Environment Variable (2/2)",
    prompt: `Enter the value for "${key.trim()}"`,
    placeHolder: "value",
    ignoreFocusOut: true,
  });

  if (value === undefined) {
    return;
  }

  try {
    const func = await getFunction(functionId);
    const env = { ...((func.env as Record<string, string>) ?? {}) };
    env[key.trim()] = value;
    const { _id, ...input } = func as unknown as Record<string, unknown>;
    (input as Record<string, unknown>).env = env;
    await replaceFunction(functionId, input as unknown as FunctionInput);
    showSuccess(`Environment variable "${key.trim()}" added`);
    treeProvider.refresh();
  } catch (err) {
    showApiError(err, "Failed to add environment variable");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Edit environment variable value (called on click)
// ─────────────────────────────────────────────────────────────────────

export async function editEnvVarCommand(
  item: SpicaTreeItem,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  if (!item?.data?.resourceId || !item.data.parentId) {
    return;
  }

  const envKey = item.data.resourceId;
  const functionId = item.data.parentId;

  try {
    const func = await getFunction(functionId);
    const env = { ...((func.env as Record<string, string>) ?? {}) };
    const currentValue = env[envKey] || "";

    const newValue = await vscode.window.showInputBox({
      title: `Edit Environment Variable: ${envKey}`,
      prompt: `Enter new value for "${envKey}"`,
      value: currentValue,
      ignoreFocusOut: true,
    });

    if (newValue === undefined) {
      return;
    }

    env[envKey] = newValue;
    const { _id, ...input } = func as unknown as Record<string, unknown>;
    (input as Record<string, unknown>).env = env;
    await replaceFunction(functionId, input as unknown as FunctionInput);
    showSuccess(`Environment variable "${envKey}" updated`);
    treeProvider.refresh();
  } catch (err) {
    showApiError(err, "Failed to edit environment variable");
  }
}

// ─────────────────────────────────────────────────────────────────────
// New bucket data via JSON editor
// ─────────────────────────────────────────────────────────────────────

async function openNewBucketDataEditor(bucketId: string): Promise<void> {
  const timestamp = Date.now();
  const uri = SpicaFileSystemProvider.buildUri(
    ModuleType.Buckets,
    bucketId,
    "data",
    `new-${timestamp}`,
  );

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "json");
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    showApiError(err, "Failed to open new document editor");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Bucket data form (dynamic from schema)
// ─────────────────────────────────────────────────────────────────────

interface SimpleFormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "json" | "select";
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

async function openBucketDataForm(
  bucketId: string,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  let bucket;
  try {
    bucket = await getBucket(bucketId);
  } catch (err) {
    showApiError(err, "Failed to load bucket schema");
    return;
  }

  const fields: SimpleFormField[] = Object.entries(bucket.properties).map(
    ([key, prop]) => ({
      name: key,
      label: prop.title || key,
      type: mapBucketPropToInputType(prop.type),
      required: bucket.required?.includes(key) ?? false,
      placeholder: prop.description || "",
    }),
  );

  const panel = vscode.window.createWebviewPanel(
    "spicaForm",
    `New Document — ${bucket.title}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildSimpleFormHtml(
    `New Document — ${bucket.title}`,
    fields,
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "submit") {
      try {
        const data = coerceValues(msg.data, bucket.properties);
        await insertBucketData(bucketId, data);
        showSuccess("Document created successfully");
        treeProvider.refresh();
        panel.dispose();
      } catch (err) {
        showApiError(err, "Failed to create document");
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Resource create / update dispatch
// ─────────────────────────────────────────────────────────────────────

function getFormTitle(moduleType: ModuleType): string | null {
  switch (moduleType) {
    case ModuleType.Buckets:
      return "Bucket";
    case ModuleType.Functions:
      return "Function";
    case ModuleType.Policies:
      return "Policy";
    default:
      return null;
  }
}

async function createResource(
  moduleType: ModuleType,
  data: Record<string, unknown>,
): Promise<void> {
  switch (moduleType) {
    case ModuleType.Buckets:
      await createBucket(buildBucketPayload(data));
      return;
    case ModuleType.Functions: {
      const fnPayload = buildFunctionPayload(data);
      const created = await createFunction(
        fnPayload as unknown as FunctionInput,
      );
      // Create default empty index for the function
      await updateFunctionIndex(created._id, "");
      return;
    }
    case ModuleType.Policies:
      await createPolicy(buildPolicyPayload(data));
      return;
  }
}

async function updateResource(
  moduleType: ModuleType,
  resourceId: string,
  data: Record<string, unknown>,
  existingData?: Record<string, unknown>,
): Promise<void> {
  switch (moduleType) {
    case ModuleType.Policies:
      await updatePolicy(resourceId, buildPolicyPayload(data));
      return;
    case ModuleType.Buckets:
      await replaceBucket(resourceId, buildBucketPayload(data));
      return;
    case ModuleType.Functions: {
      const fnPayload = buildFunctionPayload(data, existingData);
      await replaceFunction(resourceId, fnPayload as unknown as FunctionInput);
      return;
    }
  }
}

// ── Payload builders ────────────────────────────────────────────────

function buildPolicyPayload(data: Record<string, unknown>) {
  const statements = (data.statements as Array<Record<string, unknown>>) || [];
  return {
    name: data.name as string,
    description: data.description as string,
    statement: statements.map((s) => {
      const inc = s.resourceInclude as string;
      const exc = s.resourceExclude as string;
      const includeArr = inc
        ? inc
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean)
        : [];
      const excludeArr = exc
        ? exc
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean)
        : [];
      const resource =
        includeArr.length || excludeArr.length
          ? {
              ...(includeArr.length ? { include: includeArr } : {}),
              ...(excludeArr.length ? { exclude: excludeArr } : {}),
            }
          : undefined;
      return {
        action: s.action as string,
        module: s.module as string,
        ...(resource ? { resource } : {}),
      };
    }),
  };
}

function buildBucketPayload(data: Record<string, unknown>) {
  const propsArr = (data.properties as Array<Record<string, unknown>>) || [];
  const properties: Record<string, Record<string, unknown>> = {};
  const requiredKeys: string[] = [];

  for (const p of propsArr) {
    const key = p.key as string;
    if (!key) {
      continue;
    }
    const prop: Record<string, unknown> = {
      type: p.type as string,
    };
    if (p.title) {
      prop.title = p.title as string;
    }
    if (p.description) {
      prop.description = p.description as string;
    }
    if (p.readOnly === true || p.readOnly === "true") {
      prop.readOnly = true;
    }
    const t = p.type as string;
    if (t === "string" || t === "textarea" || t === "richtext") {
      if (p.minLength) {
        prop.minLength = Number(p.minLength);
      }
      if (p.maxLength) {
        prop.maxLength = Number(p.maxLength);
      }
      if (p.pattern) {
        prop.pattern = p.pattern as string;
      }
    }
    if (t === "number") {
      if (p.minimum !== undefined && p.minimum !== "") {
        prop.minimum = Number(p.minimum);
      }
      if (p.maximum !== undefined && p.maximum !== "") {
        prop.maximum = Number(p.maximum);
      }
    }
    if (t === "relation") {
      if (p.bucketId) {
        prop.bucketId = p.bucketId as string;
      }
      if (p.relationType) {
        prop.relationType = p.relationType as string;
      }
      if (p.dependent === true || p.dependent === "true") {
        prop.dependent = true;
      }
    }
    if ((t === "array" || t === "multiselect") && p.itemsType) {
      prop.items = { type: p.itemsType as string };
    }
    // Enum values — may be a string from the form or already an array (existing data)
    if (Array.isArray(p.enum) && (p.enum as unknown[]).length > 0) {
      prop.enum = p.enum;
    } else if (typeof p.enum === "string" && p.enum.trim()) {
      prop.enum = p.enum
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    // Default value
    if (p.default !== undefined && p.default !== "") {
      prop.default = p.default;
    }
    // Options: translate / history
    const optTranslate = p.optTranslate === true || p.optTranslate === "true";
    const optHistory = p.optHistory === true || p.optHistory === "true";
    if (optTranslate || optHistory) {
      prop.options = {
        ...(optTranslate ? { translate: true } : {}),
        ...(optHistory ? { history: true } : {}),
      };
    }
    if (p.isRequired === true || p.isRequired === "true") {
      requiredKeys.push(key);
    }
    properties[key] = prop;
  }
  // Document settings
  const countLimitRaw = data.countLimit;
  const countLimit =
    typeof countLimitRaw === "string" && countLimitRaw !== ""
      ? Number(countLimitRaw)
      : undefined;
  const limitExceedBehaviour =
    (data.limitExceedBehaviour as string) || undefined;
  const documentSettings =
    countLimit !== undefined || limitExceedBehaviour
      ? {
          ...(countLimit === undefined ? {} : { countLimit }),
          ...(limitExceedBehaviour
            ? {
                limitExceedBehaviour: limitExceedBehaviour as
                  | "prevent"
                  | "remove",
              }
            : {}),
        }
      : undefined;

  // ACL
  const aclRead = (data.aclRead as string) || "true==true";
  const aclWrite = (data.aclWrite as string) || "true==true";

  const rawOrder =
    data.order !== "" && data.order !== undefined && data.order !== null
      ? Number(data.order)
      : undefined;
  const orderVal = Number.isNaN(rawOrder) ? undefined : rawOrder;

  return {
    title: data.title as string,
    description: data.description as string,
    icon: (data.icon as string) || "view_stream",
    history: data.history === true || data.history === "true",
    readOnly: data.readOnly === true || data.readOnly === "true",
    primary: (data.primary as string) || undefined,
    ...(data.category ? { category: data.category as string } : {}),
    ...(orderVal === undefined ? {} : { order: orderVal }),
    acl: { read: aclRead, write: aclWrite },
    ...(documentSettings ? { documentSettings } : {}),
    properties,
    ...(requiredKeys.length ? { required: requiredKeys } : {}),
  };
}

function buildFunctionPayload(
  data: Record<string, unknown>,
  existing?: Record<string, unknown>,
) {
  const triggersArr = (data.triggers as Array<Record<string, unknown>>) || [];
  const triggers: Record<
    string,
    { type: string; active: boolean; options: Record<string, unknown> }
  > = {};

  for (const t of triggersArr) {
    const name = (t.triggerName as string) || "default";
    const options: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === "triggerName" || k === "triggerType" || k === "active") {
        continue;
      }
      // Skip empty/null/undefined values — the server may reject them
      if (v === "" || v === undefined || v === null) {
        continue;
      }
      options[k] = v;
    }
    triggers[name] = {
      type: (t.triggerType as string) || "http",
      active: t.active === true || t.active === "true",
      options,
    };
  }

  const payload: Record<string, unknown> = {
    name: data.name as string,
    language: (data.language as "typescript" | "javascript") || "typescript",
    timeout: Number(data.timeout) || 120,
    triggers,
    env: {} as Record<string, string>,
  };

  // Collect environment variables
  const envVarsArr = (data.envVars as Array<Record<string, unknown>>) || [];
  const env: Record<string, string> = {};
  for (const ev of envVarsArr) {
    const key = (ev.envKey as string) || "";
    const value = (ev.envValue as string) || "";
    if (key) {
      env[key] = value;
    }
  }
  payload.env = env;

  // Preserve existing env vars in edit mode if not provided in form
  if (existing?.env && envVarsArr.length === 0) {
    payload.env = existing.env;
  }

  if (existing?.category !== undefined) {
    payload.category = existing.category;
  }
  if (existing?.order !== undefined) {
    payload.order = existing.order;
  }

  const desc = (data.description as string) || "";
  if (desc) {
    payload.description = desc;
  }

  return payload;
}

// ─────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────

function mapBucketPropToInputType(propType?: string): SimpleFormField["type"] {
  switch (propType) {
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    case "textarea":
    case "richtext":
      return "textarea";
    case "object":
    case "json":
    case "array":
    case "location":
      return "json";
    default:
      return "text";
  }
}

function coerceValues(
  data: Record<string, unknown>,
  properties: Record<string, { type?: string }>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    const prop = properties[key];
    if (!prop) {
      result[key] = val;
      continue;
    }
    switch (prop.type) {
      case "number":
        result[key] = Number(val);
        break;
      case "boolean":
        result[key] = val === true || val === "true";
        break;
      case "object":
      case "json":
      case "array":
      case "location":
        result[key] = typeof val === "string" ? JSON.parse(val) : val;
        break;
      default:
        result[key] = val;
    }
  }
  return result;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ─────────────────────────────────────────────────────────────────────
// Simple form HTML builder (for bucket data)
// ─────────────────────────────────────────────────────────────────────

function buildSimpleFormHtml(title: string, fields: SimpleFormField[]): string {
  const fieldHtml = fields
    .map((f) => {
      const reqAttr = f.required ? "required" : "";
      const reqStar = f.required ? '<span class="req">*</span>' : "";

      switch (f.type) {
        case "textarea":
        case "json":
          return `
            <div class="field">
              <label for="${esc(f.name)}">${esc(f.label)}${reqStar}</label>
              <textarea id="${esc(f.name)}" name="${esc(f.name)}" placeholder="${esc(f.placeholder || "")}" rows="${f.type === "json" ? 8 : 4}" ${reqAttr}>${esc(f.defaultValue || "")}</textarea>
            </div>`;
        case "checkbox":
          return `
            <div class="field checkbox">
              <label>
                <input type="checkbox" id="${esc(f.name)}" name="${esc(f.name)}" />
                ${esc(f.label)}
              </label>
            </div>`;
        case "number":
          return `
            <div class="field">
              <label for="${esc(f.name)}">${esc(f.label)}${reqStar}</label>
              <input type="number" id="${esc(f.name)}" name="${esc(f.name)}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.defaultValue || "")}" ${reqAttr} />
            </div>`;
        case "select":
          return `
            <div class="field">
              <label for="${esc(f.name)}">${esc(f.label)}${reqStar}</label>
              <select id="${esc(f.name)}" name="${esc(f.name)}" ${reqAttr}>
                ${(f.options || [])
                  .map(
                    (o) =>
                      `<option value="${esc(o.value)}">${esc(o.label)}</option>`,
                  )
                  .join("")}
              </select>
            </div>`;
        default:
          return `
            <div class="field">
              <label for="${esc(f.name)}">${esc(f.label)}${reqStar}</label>
              <input type="text" id="${esc(f.name)}" name="${esc(f.name)}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.defaultValue || "")}" ${reqAttr} />
            </div>`;
      }
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  ${SHARED_STYLES}
</head>
<body>
  <h1>${esc(title)}</h1>
  <form id="form">
    ${fieldHtml}
    <div id="errorMsg" class="error-msg"></div>
    <div class="actions">
      <button type="submit" class="btn-primary">Create</button>
    </div>
  </form>
  ${SIMPLE_FORM_SCRIPT}
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────
// Structured form HTML builder (Policies / Buckets / Functions)
// ─────────────────────────────────────────────────────────────────────

function buildStructuredFormHtml(
  title: string,
  submitLabel: string,
  moduleType: ModuleType,
  functionInfo?: FunctionInformation,
  existingData?: Record<string, unknown>,
): string {
  let formBody: string;

  switch (moduleType) {
    case ModuleType.Policies:
      formBody = buildPolicyFormBody(existingData);
      break;
    case ModuleType.Buckets:
      formBody = buildBucketFormBody(existingData);
      break;
    case ModuleType.Functions:
      formBody = buildFunctionFormBody(functionInfo, existingData);
      break;
    default:
      formBody = "";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  ${SHARED_STYLES}
  ${STRUCTURED_STYLES}
</head>
<body>
  <h1>${esc(title)}</h1>
  <form id="form">
    ${formBody}
    <div id="errorMsg" class="error-msg"></div>
    <div class="actions">
      <button type="submit" class="btn-primary">${esc(submitLabel)}</button>
    </div>
  </form>
  ${buildStructuredFormScript(moduleType, functionInfo)}
</body>
</html>`;
}

// ── Policy form body ────────────────────────────────────────────────

function buildPolicyFormBody(existing?: Record<string, unknown>): string {
  const name = (existing?.name as string) || "";
  const description = (existing?.description as string) || "";
  const statements =
    (existing?.statement as Array<Record<string, unknown>>) || [];

  const statementsHtml =
    statements.length > 0
      ? statements.map((s, i) => buildPolicyStatementEntry(i, s)).join("")
      : buildPolicyStatementEntry(0);

  return `
    <div class="field">
      <label for="name">Name<span class="req">*</span></label>
      <input type="text" id="name" name="name" required placeholder="MyPolicy" value="${esc(name)}" />
    </div>
    <div class="field">
      <label for="description">Description<span class="req">*</span></label>
      <input type="text" id="description" name="description" required placeholder="Policy description" value="${esc(description)}" />
    </div>
    <div class="repeatable-section" id="statementsSection">
      <div class="section-header">
        <h2>Statements<span class="req">*</span></h2>
        <button type="button" class="btn-add" onclick="addStatement()">+ Add Statement</button>
      </div>
      <div id="statementsContainer">
        ${statementsHtml}
      </div>
    </div>`;
}

function buildPolicyStatementEntry(
  index: number,
  data?: Record<string, unknown>,
): string {
  const action = (data?.action as string) || "";
  const module = (data?.module as string) || "";
  const resource = data?.resource as Record<string, unknown> | undefined;
  const include = (resource?.include as string[])?.join(", ") || "";
  const exclude = (resource?.exclude as string[])?.join(", ") || "";

  return `
    <div class="repeatable-entry" data-index="${index}">
      <div class="entry-header">
        <span class="entry-title">Statement #${index + 1}</span>
        <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
      </div>
      <div class="entry-fields">
        <div class="field-row">
          <div class="field">
            <label>Action<span class="req">*</span></label>
            <input type="text" data-field="action" required placeholder="bucket:index" value="${esc(action)}" />
          </div>
          <div class="field">
            <label>Module<span class="req">*</span></label>
            <input type="text" data-field="module" required placeholder="bucket:data" value="${esc(module)}" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Resource Include</label>
            <input type="text" data-field="resourceInclude" placeholder="id1, id2 (comma-separated)" value="${esc(include)}" />
            <span class="hint">Comma-separated resource IDs to include</span>
          </div>
          <div class="field">
            <label>Resource Exclude</label>
            <input type="text" data-field="resourceExclude" placeholder="id1, id2 (comma-separated)" value="${esc(exclude)}" />
            <span class="hint">Comma-separated resource IDs to exclude</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Bucket form body ────────────────────────────────────────────────

function buildBucketFormBody(existing?: Record<string, unknown>): string {
  const title = (existing?.title as string) || "";
  const description = (existing?.description as string) || "";
  const icon = (existing?.icon as string) || "view_stream";
  const history = existing?.history === true;
  const readOnly = existing?.readOnly === true;
  const primary = (existing?.primary as string) || "";
  const category = (existing?.category as string) || "";
  const order =
    typeof existing?.order === "number" ? String(existing.order) : "";

  // ACL
  const acl = existing?.acl as Record<string, string> | undefined;
  const aclRead = acl?.read ?? "true==true";
  const aclWrite = acl?.write ?? "true==true";

  // Document settings
  const docSettings = existing?.documentSettings as
    | Record<string, unknown>
    | undefined;
  const countLimit =
    typeof docSettings?.countLimit === "number"
      ? String(docSettings.countLimit)
      : "";
  const limitExceedBehaviour =
    (docSettings?.limitExceedBehaviour as string) || "";

  // Properties
  const existingProps = existing?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const requiredKeys = (existing?.required as string[]) || [];

  let propertiesHtml: string;
  if (existingProps && Object.keys(existingProps).length > 0) {
    propertiesHtml = Object.entries(existingProps)
      .map(([key, prop], i) =>
        buildBucketPropertyEntry(i, {
          key,
          ...prop,
          isRequired: requiredKeys.includes(key),
        }),
      )
      .join("");
  } else {
    propertiesHtml = buildBucketPropertyEntry(0, {
      key: "title",
      title: "Title",
      type: "string",
    });
  }

  return `
    <div class="field-row">
      <div class="field">
        <label for="title">Title<span class="req">*</span></label>
        <input type="text" id="title" name="title" required placeholder="My Bucket" minlength="4" maxlength="100" value="${esc(title)}" />
      </div>
      <div class="field">
        <label for="icon">Icon</label>
        <input type="text" id="icon" name="icon" placeholder="view_stream" value="${esc(icon)}" />
      </div>
    </div>
    <div class="field">
      <label for="description">Description<span class="req">*</span></label>
      <textarea id="description" name="description" required placeholder="A short description" rows="2" minlength="5" maxlength="250">${esc(description)}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="category">Category</label>
        <input type="text" id="category" name="category" placeholder="e.g. Content" value="${esc(category)}" />
      </div>
      <div class="field">
        <label for="order">Order</label>
        <input type="number" id="order" name="order" placeholder="0" value="${esc(order)}" />
      </div>
    </div>
    <div class="field-row">
      <div class="field checkbox">
        <label><input type="checkbox" id="history" name="history" ${history ? "checked" : ""} /> Enable History</label>
      </div>
      <div class="field checkbox">
        <label><input type="checkbox" id="readOnly" name="readOnly" ${readOnly ? "checked" : ""} /> Read Only</label>
      </div>
    </div>
    <div class="field">
      <label for="primary">Primary Field</label>
      <input type="text" id="primary" name="primary" placeholder="Property key to use as primary" value="${esc(primary)}" />
      <span class="hint">The property key that identifies documents (e.g., "title")</span>
    </div>
    <h3 class="section-label">Access Control</h3>
    <div class="field-row">
      <div class="field">
        <label for="aclRead">Read Rule</label>
        <input type="text" id="aclRead" name="aclRead" placeholder="true==true" value="${esc(aclRead)}" />
        <span class="hint">ACL expression for read access (e.g. true==true)</span>
      </div>
      <div class="field">
        <label for="aclWrite">Write Rule</label>
        <input type="text" id="aclWrite" name="aclWrite" placeholder="true==true" value="${esc(aclWrite)}" />
        <span class="hint">ACL expression for write access</span>
      </div>
    </div>
    <h3 class="section-label">Document Settings</h3>
    <div class="field-row">
      <div class="field">
        <label for="countLimit">Count Limit</label>
        <input type="number" id="countLimit" name="countLimit" min="1" placeholder="No limit" value="${esc(countLimit)}" />
        <span class="hint">Maximum number of documents allowed</span>
      </div>
      <div class="field">
        <label for="limitExceedBehaviour">Limit Exceed Behaviour</label>
        <select id="limitExceedBehaviour" name="limitExceedBehaviour">
          <option value="" ${limitExceedBehaviour === "" ? "selected" : ""}>(none)</option>
          <option value="prevent" ${limitExceedBehaviour === "prevent" ? "selected" : ""}>Prevent</option>
          <option value="remove" ${limitExceedBehaviour === "remove" ? "selected" : ""}>Remove Oldest</option>
        </select>
      </div>
    </div>
    <div class="repeatable-section" id="propertiesSection">
      <div class="section-header">
        <h2>Properties<span class="req">*</span></h2>
        <button type="button" class="btn-add" onclick="addProperty()">+ Add Property</button>
      </div>
      <div id="propertiesContainer">
        ${propertiesHtml}
      </div>
    </div>`;
}

function buildBucketPropertyEntry(
  index: number,
  data?: Record<string, unknown>,
): string {
  const key = (data?.key as string) || "";
  const title = (data?.title as string) || "";
  const type = (data?.type as string) || "string";
  const description = (data?.description as string) || "";
  const readOnly = data?.readOnly === true;
  const isRequired = data?.isRequired === true;

  const minLength = data?.minLength != null ? Number(data.minLength) : "";
  const maxLength = data?.maxLength != null ? Number(data.maxLength) : "";
  const pattern = (data?.pattern as string) || "";
  const minimum = data?.minimum != null ? Number(data.minimum) : "";
  const maximum = data?.maximum != null ? Number(data.maximum) : "";
  const bucketId = (data?.bucketId as string) || "";
  const relationType = (data?.relationType as string) || "onetoone";
  const dependent = data?.dependent === true;
  const itemsType = (data?.items as Record<string, unknown>)?.type || "string";
  const enumValues = Array.isArray(data?.enum)
    ? (data.enum as unknown[]).join(", ")
    : "";
  const defaultValue =
    data?.default != null ? String(data.default as string) : "";
  const optionsObj = data?.options as Record<string, unknown> | undefined;
  const translateOption = optionsObj?.translate === true;
  const historyOption = optionsObj?.history === true;

  const typeOptions = [
    "string",
    "number",
    "boolean",
    "textarea",
    "richtext",
    "date",
    "color",
    "object",
    "array",
    "json",
    "relation",
    "location",
    "storage",
    "multiselect",
    "hash",
    "encrypted",
  ];

  const showStringFields =
    type === "string" || type === "textarea" || type === "richtext";
  const showNumberFields = type === "number";
  const showRelationFields = type === "relation";
  const showArrayFields = type === "array" || type === "multiselect";

  return `
    <div class="repeatable-entry" data-index="${index}">
      <div class="entry-header">
        <span class="entry-title">Property #${index + 1}</span>
        <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
      </div>
      <div class="entry-fields">
        <div class="field-row">
          <div class="field">
            <label>Key<span class="req">*</span></label>
            <input type="text" data-field="key" required placeholder="field_name" value="${esc(String(key))}" />
          </div>
          <div class="field">
            <label>Title</label>
            <input type="text" data-field="title" placeholder="Display Name" value="${esc(String(title))}" />
          </div>
          <div class="field">
            <label>Type<span class="req">*</span></label>
            <select data-field="type" required onchange="onPropertyTypeChange(this)">
              ${typeOptions.map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Description</label>
          <input type="text" data-field="description" placeholder="Field description" value="${esc(String(description))}" />
        </div>
        <div class="field-row">
          <div class="field checkbox">
            <label><input type="checkbox" data-field="readOnly" ${readOnly ? "checked" : ""} /> Read Only</label>
          </div>
          <div class="field checkbox">
            <label><input type="checkbox" data-field="isRequired" ${isRequired ? "checked" : ""} /> Required</label>
          </div>
        </div>
        <div class="conditional-fields string-fields" style="display:${showStringFields ? "block" : "none"}">
          <div class="field-row">
            <div class="field">
              <label>Min Length</label>
              <input type="number" data-field="minLength" min="0" value="${esc(String(minLength))}" />
            </div>
            <div class="field">
              <label>Max Length</label>
              <input type="number" data-field="maxLength" min="0" value="${esc(String(maxLength))}" />
            </div>
            <div class="field">
              <label>Pattern</label>
              <input type="text" data-field="pattern" placeholder="regex" value="${esc(pattern)}" />
            </div>
          </div>
        </div>
        <div class="conditional-fields number-fields" style="display:${showNumberFields ? "block" : "none"}">
          <div class="field-row">
            <div class="field">
              <label>Minimum</label>
              <input type="number" data-field="minimum" value="${esc(String(minimum))}" />
            </div>
            <div class="field">
              <label>Maximum</label>
              <input type="number" data-field="maximum" value="${esc(String(maximum))}" />
            </div>
          </div>
        </div>
        <div class="conditional-fields relation-fields" style="display:${showRelationFields ? "block" : "none"}">
          <div class="field-row">
            <div class="field">
              <label>Bucket ID<span class="req">*</span></label>
              <input type="text" data-field="bucketId" placeholder="Target bucket ID" value="${esc(bucketId)}" />
            </div>
            <div class="field">
              <label>Relation Type</label>
              <select data-field="relationType">
                <option value="onetoone" ${relationType === "onetoone" ? "selected" : ""}>One to One</option>
                <option value="onetomany" ${relationType === "onetomany" ? "selected" : ""}>One to Many</option>
              </select>
            </div>
            <div class="field checkbox">
              <label><input type="checkbox" data-field="dependent" ${dependent ? "checked" : ""} /> Dependent</label>
            </div>
          </div>
        </div>
        <div class="conditional-fields array-fields" style="display:${showArrayFields ? "block" : "none"}">
          <div class="field">
            <label>Items Type</label>
            <select data-field="itemsType">
              ${["string", "number", "boolean", "object", "date"].map((t) => `<option value="${t}" ${t === itemsType ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Default Value</label>
          <input type="text" data-field="default" placeholder="Default value" value="${esc(defaultValue)}" />
        </div>
        <div class="field">
          <label>Enum Values</label>
          <input type="text" data-field="enum" placeholder="val1, val2, val3" value="${esc(enumValues)}" />
          <span class="hint">Comma-separated allowed values (leave empty to allow any)</span>
        </div>
        <div class="field-row">
          <div class="field checkbox">
            <label><input type="checkbox" data-field="optTranslate" ${translateOption ? "checked" : ""} /> Translatable</label>
          </div>
          <div class="field checkbox">
            <label><input type="checkbox" data-field="optHistory" ${historyOption ? "checked" : ""} /> Track History</label>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Function form body (dynamic) ────────────────────────────────────

function buildFunctionFormBody(
  info?: FunctionInformation,
  existing?: Record<string, unknown>,
): string {
  const name = (existing?.name as string) || "";
  const description = (existing?.description as string) || "";
  const language = (existing?.language as string) || "typescript";
  const timeoutMax = info?.timeout || 120;
  const timeout = existing?.timeout ? Number(existing.timeout) : timeoutMax;

  const runtimesInfo = info?.runtimes
    ? info.runtimes.map((r) => `${r.title}: ${r.description}`).join(" | ")
    : "";

  const existingTriggers = existing?.triggers as
    | Record<string, Record<string, unknown>>
    | undefined;
  let triggersHtml: string;
  if (existingTriggers && Object.keys(existingTriggers).length > 0) {
    triggersHtml = Object.entries(existingTriggers)
      .map(([triggerName, trigger], i) =>
        buildFunctionTriggerEntry(i, info?.enqueuers || [], {
          triggerName,
          ...trigger,
        }),
      )
      .join("");
  } else {
    triggersHtml = buildFunctionTriggerEntry(0, info?.enqueuers || []);
  }

  // Environment variables
  const existingEnv = existing?.env as Record<string, string> | undefined;
  let envVarsHtml: string;
  if (existingEnv && Object.keys(existingEnv).length > 0) {
    envVarsHtml = Object.entries(existingEnv)
      .map(([key, value], i) =>
        buildFunctionEnvVarEntry(i, { envKey: key, envValue: value }),
      )
      .join("");
  } else {
    envVarsHtml = "";
  }

  return `
    <div class="field-row">
      <div class="field" style="flex:2">
        <label for="name">Name<span class="req">*</span></label>
        <input type="text" id="name" name="name" required placeholder="myFunction" value="${esc(name)}" />
      </div>
      <div class="field">
        <label for="language">Language<span class="req">*</span></label>
        <select id="language" name="language" required>
          <option value="typescript" ${language === "typescript" ? "selected" : ""}>TypeScript</option>
          <option value="javascript" ${language === "javascript" ? "selected" : ""}>JavaScript</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="description">Description</label>
      <input type="text" id="description" name="description" placeholder="Describe the function" value="${esc(description)}" />
    </div>
    <div class="field">
      <label for="timeout">Timeout (seconds)<span class="req">*</span></label>
      <input type="number" id="timeout" name="timeout" required min="1" max="${timeoutMax}" value="${timeout}" />
      <span class="hint">Maximum: ${timeoutMax} seconds</span>
    </div>
    <div class="repeatable-section" id="triggersSection">
      <div class="section-header">
        <h2>Triggers<span class="req">*</span></h2>
        <button type="button" class="btn-add" onclick="addTrigger()">+ Add Trigger</button>
      </div>
      <div id="triggersContainer">
        ${triggersHtml}
      </div>
    </div>
    <div class="repeatable-section" id="envVarsSection">
      <div class="section-header">
        <h2>Environment Variables</h2>
        <button type="button" class="btn-add" onclick="addEnvVar()">+ Add Variable</button>
      </div>
      <div id="envVarsContainer">
        ${envVarsHtml}
      </div>
    </div>`;
}

function buildFunctionTriggerEntry(
  index: number,
  enqueuers: FunctionEnqueuer[],
  data?: Record<string, unknown>,
): string {
  const triggerName = (data?.triggerName as string) || "default";
  const type =
    (data?.type as string) || enqueuers[0]?.description.name || "http";
  const active = data?.active !== false;
  const options = (data?.options as Record<string, unknown>) || {};

  const selectedEnqueuer = enqueuers.find((e) => e.description.name === type);

  const typeOptions = enqueuers
    .map(
      (e) =>
        `<option value="${esc(e.description.name)}" ${e.description.name === type ? "selected" : ""}>${esc(e.description.title)}</option>`,
    )
    .join("");

  const typeInput =
    enqueuers.length > 0
      ? `<select data-field="triggerType" required onchange="onTriggerTypeChange(this)">${typeOptions}</select>`
      : `<input type="text" data-field="triggerType" required placeholder="http" value="${esc(type)}" />`;

  const optionsHtml = selectedEnqueuer
    ? buildEnqueuerOptionFields(selectedEnqueuer, options)
    : `<div class="field">
        <label>Options (JSON)</label>
        <textarea data-field="optionsJson" rows="4" placeholder='{"method": "Get", "path": "/"}'>${esc(JSON.stringify(options, null, 2))}</textarea>
       </div>`;

  return `
    <div class="repeatable-entry trigger-entry" data-index="${index}">
      <div class="entry-header">
        <span class="entry-title">Trigger #${index + 1}</span>
        <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
      </div>
      <div class="entry-fields">
        <div class="field-row">
          <div class="field">
            <label>Name<span class="req">*</span></label>
            <input type="text" data-field="triggerName" required placeholder="default" value="${esc(triggerName)}" />
          </div>
          <div class="field">
            <label>Type<span class="req">*</span></label>
            ${typeInput}
          </div>
          <div class="field checkbox" style="align-self:flex-end">
            <label><input type="checkbox" data-field="active" ${active ? "checked" : ""} /> Active</label>
          </div>
        </div>
        <div class="trigger-options" data-trigger-type="${esc(type)}">
          <h3>Options</h3>
          ${optionsHtml}
        </div>
      </div>
    </div>`;
}

function buildFunctionEnvVarEntry(
  index: number,
  data?: Record<string, unknown>,
): string {
  const envKey = (data?.envKey as string) || "";
  const envValue = (data?.envValue as string) || "";

  return `
    <div class="repeatable-entry env-var-entry" data-index="${index}">
      <div class="entry-header">
        <span class="entry-title">Variable #${index + 1}</span>
        <button type="button" class="btn-remove" onclick="removeEnvVarEntry(this)">✕</button>
      </div>
      <div class="entry-fields">
        <div class="field-row">
          <div class="field">
            <label>Key<span class="req">*</span></label>
            <input type="text" data-field="envKey" required placeholder="MY_VAR" value="${esc(envKey)}" />
          </div>
          <div class="field">
            <label>Value</label>
            <input type="text" data-field="envValue" placeholder="value" value="${esc(envValue)}" />
          </div>
        </div>
      </div>
    </div>`;
}

function buildEnqueuerOptionFields(
  enqueuer: FunctionEnqueuer,
  values: Record<string, unknown>,
): string {
  const schema = enqueuer.options;
  if (!schema.properties) {
    return "";
  }

  const requiredFields = schema.required || [];

  return Object.entries(schema.properties)
    .map(([propName, propSchema]) => {
      const isRequired = requiredFields.includes(propName);
      const reqStar = isRequired ? '<span class="req">*</span>' : "";
      const reqAttr = isRequired ? "required" : "";
      const pTitle = propSchema.title || propName;
      const desc = propSchema.description || "";
      const currentValue = values[propName];
      const defaultValue = propSchema.default;
      let value = "";
      if (currentValue !== undefined && currentValue !== null) {
        value =
          typeof currentValue === "object"
            ? JSON.stringify(currentValue)
            : String(currentValue);
      } else if (defaultValue !== undefined && defaultValue !== null) {
        value =
          typeof defaultValue === "object"
            ? JSON.stringify(defaultValue)
            : String(defaultValue);
      }
      const examples = propSchema.examples || [];
      const placeholder =
        desc || (examples.length ? `e.g., ${examples[0]}` : "");

      if (propSchema.type === "boolean") {
        const checked =
          currentValue === true ||
          currentValue === "true" ||
          (currentValue === undefined && defaultValue === true);
        return `
          <div class="field checkbox">
            <label>
              <input type="checkbox" data-field="${esc(propName)}" ${checked ? "checked" : ""} />
              ${esc(pTitle)}
            </label>
            ${desc ? `<span class="hint">${esc(desc)}</span>` : ""}
          </div>`;
      }

      if (propSchema.enum && propSchema.enum.length > 0) {
        const viewLabels = propSchema.viewEnum || propSchema.enum;
        const opts = propSchema.enum
          .map(
            (v, i) =>
              `<option value="${esc(String(v))}" ${String(v) === value ? "selected" : ""}>${esc(String(viewLabels[i] ?? v))}</option>`,
          )
          .join("");
        return `
          <div class="field">
            <label>${esc(pTitle)}${reqStar}</label>
            <select data-field="${esc(propName)}" ${reqAttr}>${opts}</select>
            ${desc ? `<span class="hint">${esc(desc)}</span>` : ""}
          </div>`;
      }

      return `
        <div class="field">
          <label>${esc(pTitle)}${reqStar}</label>
          <input type="text" data-field="${esc(propName)}" ${reqAttr} placeholder="${esc(placeholder)}" value="${esc(value)}" />
          ${desc ? `<span class="hint">${esc(desc)}</span>` : ""}
          ${examples.length > 1 ? `<span class="hint">Examples: ${examples.map((e) => esc(e)).join(", ")}</span>` : ""}
        </div>`;
    })
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// CSS constants
// ─────────────────────────────────────────────────────────────────────

const SHARED_STYLES = `<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --focus: var(--vscode-focusBorder);
    --error: var(--vscode-errorForeground, #f44);
    --border: var(--vscode-panel-border, #444);
    --subtle: var(--vscode-descriptionForeground, #888);
  }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--fg);
    background: var(--bg);
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
  }
  h1 { font-size: 1.4em; margin-bottom: 20px; font-weight: 600; }
  h2 { font-size: 1.1em; margin: 0; font-weight: 600; }
  h3 { font-size: 0.95em; margin: 8px 0 4px; font-weight: 500; color: var(--subtle); }
  .field { margin-bottom: 12px; flex: 1; }
  label { display: block; margin-bottom: 4px; font-weight: 500; }
  .req { color: var(--error); margin-left: 2px; }
  .hint { display: block; font-size: 0.85em; color: var(--subtle); margin-top: 2px; }
  input[type="text"], input[type="number"], textarea, select {
    width: 100%; padding: 6px 8px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    font-family: inherit; font-size: inherit; box-sizing: border-box;
  }
  textarea { resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--focus); }
  .checkbox label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .actions { margin-top: 24px; display: flex; gap: 10px; }
  button { padding: 8px 20px; border: none; border-radius: 3px; cursor: pointer; font-size: inherit; }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .error-msg { color: var(--error); font-size: 0.9em; margin-top: 8px; display: none; }
</style>`;

const STRUCTURED_STYLES = `<style>
  .field-row { display: flex; gap: 12px; align-items: flex-start; }
  .field-row > .field { flex: 1; }
  .repeatable-section { margin: 20px 0; }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  .btn-add {
    padding: 4px 12px; border: 1px solid var(--btn-bg);
    background: transparent; color: var(--btn-bg);
    border-radius: 3px; cursor: pointer; font-size: 0.9em;
  }
  .btn-add:hover { background: var(--btn-bg); color: var(--btn-fg); }
  .repeatable-entry {
    border: 1px solid var(--border); border-radius: 4px;
    padding: 12px; margin-bottom: 12px; position: relative;
    background: color-mix(in srgb, var(--input-bg) 50%, transparent);
  }
  .entry-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 8px;
  }
  .entry-title { font-weight: 600; font-size: 0.95em; }
  .btn-remove {
    background: transparent; border: 1px solid var(--error);
    color: var(--error); width: 24px; height: 24px;
    border-radius: 3px; cursor: pointer; font-size: 14px;
    display: flex; align-items: center; justify-content: center; padding: 0;
  }
  .btn-remove:hover { background: var(--error); color: var(--bg); }
  .conditional-fields {
    margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);
  }
  .trigger-options {
    margin-top: 8px; padding: 8px; border-top: 1px dashed var(--border);
  }
  .trigger-options h3 { margin-top: 0; }
  .section-label {
    font-size: 0.8em; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--subtle);
    margin: 16px 0 4px; border-bottom: 1px solid var(--border); padding-bottom: 4px;
  }
</style>`;

// ─────────────────────────────────────────────────────────────────────
// Script constants
// ─────────────────────────────────────────────────────────────────────

const SIMPLE_FORM_SCRIPT = `<script>
  const vscode = acquireVsCodeApi();
  const form = document.getElementById("form");
  const errorMsg = document.getElementById("errorMsg");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {};
    const inputs = form.querySelectorAll("input, textarea, select");
    for (const el of inputs) {
      if (el.type === "checkbox") {
        data[el.name] = el.checked;
      } else {
        data[el.name] = el.value;
      }
    }

    const jsonFields = form.querySelectorAll("textarea");
    for (const ta of jsonFields) {
      if (ta.value.trim()) {
        try { JSON.parse(ta.value); }
        catch (err) {
          errorMsg.textContent = "Invalid JSON in " + ta.name + ": " + err.message;
          errorMsg.style.display = "block";
          ta.focus();
          return;
        }
      }
    }

    errorMsg.style.display = "none";
    vscode.postMessage({ type: "submit", data });
  });
</script>`;

// ─────────────────────────────────────────────────────────────────────
// Structured form script builder
// ─────────────────────────────────────────────────────────────────────

function buildStructuredFormScript(
  moduleType: ModuleType,
  functionInfo?: FunctionInformation,
): string {
  const enqueuersJson = functionInfo?.enqueuers
    ? JSON.stringify(functionInfo.enqueuers)
    : "[]";

  // Per-module collection logic
  let collectionCode = "";
  switch (moduleType) {
    case ModuleType.Policies:
      collectionCode = `
      // Policy statements
      const stmtEntries = document.querySelectorAll("#statementsContainer .repeatable-entry");
      data.statements = [];
      stmtEntries.forEach(entry => { data.statements.push(collectEntryData(entry)); });
      if (data.statements.length === 0) {
        errorMsg.textContent = "At least one statement is required.";
        errorMsg.style.display = "block";
        return;
      }`;
      break;
    case ModuleType.Buckets:
      collectionCode = `
      // Bucket properties
      const propEntries = document.querySelectorAll("#propertiesContainer .repeatable-entry");
      data.properties = [];
      propEntries.forEach(entry => { data.properties.push(collectEntryData(entry)); });
      if (data.properties.length === 0) {
        errorMsg.textContent = "At least one property is required.";
        errorMsg.style.display = "block";
        return;
      }`;
      break;
    case ModuleType.Functions:
      collectionCode = `
      // Function triggers
      const trigEntries = document.querySelectorAll("#triggersContainer .repeatable-entry");
      data.triggers = [];
      for (const entry of trigEntries) {
        const td = collectEntryData(entry);
        if (td.optionsJson) {
          try {
            const parsed = JSON.parse(td.optionsJson);
            delete td.optionsJson;
            Object.assign(td, parsed);
          } catch (err) {
            errorMsg.textContent = "Invalid JSON in trigger options: " + err.message;
            errorMsg.style.display = "block";
            return;
          }
        }
        data.triggers.push(td);
      }
      if (data.triggers.length === 0) {
        errorMsg.textContent = "At least one trigger is required.";
        errorMsg.style.display = "block";
        return;
      }

      // Environment variables
      const envEntries = document.querySelectorAll("#envVarsContainer .repeatable-entry");
      data.envVars = [];
      envEntries.forEach(entry => { data.envVars.push(collectEntryData(entry)); });`;
      break;
  }

  return `<script>
    const vscode = acquireVsCodeApi();
    const form = document.getElementById("form");
    const errorMsg = document.getElementById("errorMsg");
    const enqueuers = ${enqueuersJson};

    // ── Shared helpers ──────────────────────────────────────────────

    function removeEntry(btn) {
      const entry = btn.closest(".repeatable-entry");
      const container = entry.parentElement;
      if (container.children.length <= 1) {
        errorMsg.textContent = "At least one entry is required.";
        errorMsg.style.display = "block";
        return;
      }
      entry.remove();
      renumberEntries(container);
      errorMsg.style.display = "none";
    }

    function renumberEntries(container) {
      const entries = container.querySelectorAll(".repeatable-entry");
      entries.forEach((entry, i) => {
        entry.dataset.index = i;
        const title = entry.querySelector(".entry-title");
        if (title) {
          title.textContent = title.textContent.replace(/#\\d+/, "#" + (i + 1));
        }
      });
    }

    function collectEntryData(entry) {
      const data = {};
      const inputs = entry.querySelectorAll("[data-field]");
      for (const el of inputs) {
        const field = el.dataset.field;
        if (el.type === "checkbox") {
          data[field] = el.checked;
        } else {
          data[field] = el.value;
        }
      }
      return data;
    }

    // ── Policy: Add Statement ───────────────────────────────────────

    function addStatement() {
      const container = document.getElementById("statementsContainer");
      const index = container.children.length;
      const html = \`
        <div class="repeatable-entry" data-index="\${index}">
          <div class="entry-header">
            <span class="entry-title">Statement #\${index + 1}</span>
            <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
          </div>
          <div class="entry-fields">
            <div class="field-row">
              <div class="field">
                <label>Action<span class="req">*</span></label>
                <input type="text" data-field="action" required placeholder="bucket:index" />
              </div>
              <div class="field">
                <label>Module<span class="req">*</span></label>
                <input type="text" data-field="module" required placeholder="bucket:data" />
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label>Resource Include</label>
                <input type="text" data-field="resourceInclude" placeholder="id1, id2 (comma-separated)" />
                <span class="hint">Comma-separated resource IDs to include</span>
              </div>
              <div class="field">
                <label>Resource Exclude</label>
                <input type="text" data-field="resourceExclude" placeholder="id1, id2 (comma-separated)" />
                <span class="hint">Comma-separated resource IDs to exclude</span>
              </div>
            </div>
          </div>
        </div>\`;
      container.insertAdjacentHTML("beforeend", html);
    }

    // ── Bucket: Add Property ────────────────────────────────────────

    function addProperty() {
      const container = document.getElementById("propertiesContainer");
      const index = container.children.length;
      const typeOptions = ["string","number","boolean","textarea","richtext","date","color","object","array","json","relation","location","storage","multiselect","hash","encrypted"];
      const optHtml = typeOptions.map(t => '<option value="' + t + '">' + t + '</option>').join("");
      const itemsTypeOptions = ["string","number","boolean","object","date"];
      const itemsOptHtml = itemsTypeOptions.map(t => '<option value="' + t + '">' + t + '</option>').join("");
      const html = \`
        <div class="repeatable-entry" data-index="\${index}">
          <div class="entry-header">
            <span class="entry-title">Property #\${index + 1}</span>
            <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
          </div>
          <div class="entry-fields">
            <div class="field-row">
              <div class="field">
                <label>Key<span class="req">*</span></label>
                <input type="text" data-field="key" required placeholder="field_name" />
              </div>
              <div class="field">
                <label>Title</label>
                <input type="text" data-field="title" placeholder="Display Name" />
              </div>
              <div class="field">
                <label>Type<span class="req">*</span></label>
                <select data-field="type" required onchange="onPropertyTypeChange(this)">\${optHtml}</select>
              </div>
            </div>
            <div class="field">
              <label>Description</label>
              <input type="text" data-field="description" placeholder="Field description" />
            </div>
            <div class="field-row">
              <div class="field checkbox">
                <label><input type="checkbox" data-field="readOnly" /> Read Only</label>
              </div>
              <div class="field checkbox">
                <label><input type="checkbox" data-field="isRequired" /> Required</label>
              </div>
            </div>
            <div class="conditional-fields string-fields" style="display:block">
              <div class="field-row">
                <div class="field"><label>Min Length</label><input type="number" data-field="minLength" min="0" /></div>
                <div class="field"><label>Max Length</label><input type="number" data-field="maxLength" min="0" /></div>
                <div class="field"><label>Pattern</label><input type="text" data-field="pattern" placeholder="regex" /></div>
              </div>
            </div>
            <div class="conditional-fields number-fields" style="display:none">
              <div class="field-row">
                <div class="field"><label>Minimum</label><input type="number" data-field="minimum" /></div>
                <div class="field"><label>Maximum</label><input type="number" data-field="maximum" /></div>
              </div>
            </div>
            <div class="conditional-fields relation-fields" style="display:none">
              <div class="field-row">
                <div class="field"><label>Bucket ID<span class="req">*</span></label><input type="text" data-field="bucketId" placeholder="Target bucket ID" /></div>
                <div class="field"><label>Relation Type</label><select data-field="relationType"><option value="onetoone">One to One</option><option value="onetomany">One to Many</option></select></div>
                <div class="field checkbox"><label><input type="checkbox" data-field="dependent" /> Dependent</label></div>
              </div>
            </div>
            <div class="conditional-fields array-fields" style="display:none">
              <div class="field">
                <label>Items Type</label>
                <select data-field="itemsType">\${itemsOptHtml}</select>
              </div>
            </div>
            <div class="field">
              <label>Default Value</label>
              <input type="text" data-field="default" placeholder="Default value" />
            </div>
            <div class="field">
              <label>Enum Values</label>
              <input type="text" data-field="enum" placeholder="val1, val2, val3" />
              <span class="hint">Comma-separated allowed values (leave empty to allow any)</span>
            </div>
            <div class="field-row">
              <div class="field checkbox">
                <label><input type="checkbox" data-field="optTranslate" /> Translatable</label>
              </div>
              <div class="field checkbox">
                <label><input type="checkbox" data-field="optHistory" /> Track History</label>
              </div>
            </div>
          </div>
        </div>\`;
      container.insertAdjacentHTML("beforeend", html);
    }

    function onPropertyTypeChange(selectEl) {
      const entry = selectEl.closest(".repeatable-entry");
      const type = selectEl.value;
      const show = (cls, visible) => {
        const el = entry.querySelector("." + cls);
        if (el) el.style.display = visible ? "block" : "none";
      };
      show("string-fields", type === "string" || type === "textarea" || type === "richtext");
      show("number-fields", type === "number");
      show("relation-fields", type === "relation");
      show("array-fields", type === "array" || type === "multiselect");
    }

    // ── Function: Add Trigger ───────────────────────────────────────

    function addTrigger() {
      const container = document.getElementById("triggersContainer");
      const index = container.children.length;
      const defaultType = enqueuers.length > 0 ? enqueuers[0].description.name : "http";
      let typeInput;
      if (enqueuers.length > 0) {
        const opts = enqueuers.map(e =>
          '<option value="' + e.description.name + '">' + e.description.title + '</option>'
        ).join("");
        typeInput = '<select data-field="triggerType" required onchange="onTriggerTypeChange(this)">' + opts + '</select>';
      } else {
        typeInput = '<input type="text" data-field="triggerType" required placeholder="http" />';
      }

      const optionsHtml = buildTriggerOptionsHtml(defaultType);

      const html = \`
        <div class="repeatable-entry trigger-entry" data-index="\${index}">
          <div class="entry-header">
            <span class="entry-title">Trigger #\${index + 1}</span>
            <button type="button" class="btn-remove" onclick="removeEntry(this)">✕</button>
          </div>
          <div class="entry-fields">
            <div class="field-row">
              <div class="field">
                <label>Name<span class="req">*</span></label>
                <input type="text" data-field="triggerName" required placeholder="default" value="default" />
              </div>
              <div class="field">
                <label>Type<span class="req">*</span></label>
                \${typeInput}
              </div>
              <div class="field checkbox" style="align-self:flex-end">
                <label><input type="checkbox" data-field="active" checked /> Active</label>
              </div>
            </div>
            <div class="trigger-options" data-trigger-type="\${defaultType}">
              <h3>Options</h3>
              \${optionsHtml}
            </div>
          </div>
        </div>\`;
      container.insertAdjacentHTML("beforeend", html);
    }

    function onTriggerTypeChange(selectEl) {
      const entry = selectEl.closest(".trigger-entry");
      const type = selectEl.value;
      const optionsDiv = entry.querySelector(".trigger-options");
      optionsDiv.dataset.triggerType = type;
      optionsDiv.innerHTML = "<h3>Options</h3>" + buildTriggerOptionsHtml(type);
    }

    function buildTriggerOptionsHtml(type) {
      const enqueuer = enqueuers.find(e => e.description.name === type);
      if (!enqueuer || !enqueuer.options || !enqueuer.options.properties) {
        return '<div class="field">' +
          '<label>Options (JSON)</label>' +
          '<textarea data-field="optionsJson" rows="4" placeholder=\\'"{"key": "value"}\\'></textarea>' +
          '</div>';
      }

      const schema = enqueuer.options;
      const required = schema.required || [];
      let html = "";

      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isReq = required.includes(propName);
        const reqStar = isReq ? '<span class="req">*</span>' : "";
        const reqAttr = isReq ? "required" : "";
        const title = propSchema.title || propName;
        const desc = propSchema.description || "";
        const examples = propSchema.examples || [];
        const defVal = propSchema.default !== undefined ? String(propSchema.default) : "";
        const placeholder = desc || (examples.length ? "e.g., " + examples[0] : "");

        if (propSchema.type === "boolean") {
          const checked = propSchema.default === true ? "checked" : "";
          html += '<div class="field checkbox">' +
            '<label><input type="checkbox" data-field="' + propName + '" ' + checked + ' /> ' + title + '</label>' +
            (desc ? '<span class="hint">' + desc + '</span>' : "") +
            '</div>';
        } else if (propSchema.enum && propSchema.enum.length > 0) {
          const viewLabels = propSchema.viewEnum || propSchema.enum;
          const opts = propSchema.enum.map((v, i) =>
            '<option value="' + v + '"' + (String(v) === defVal ? ' selected' : '') + '>' + (viewLabels[i] || v) + '</option>'
          ).join("");
          html += '<div class="field">' +
            '<label>' + title + reqStar + '</label>' +
            '<select data-field="' + propName + '" ' + reqAttr + '>' + opts + '</select>' +
            (desc ? '<span class="hint">' + desc + '</span>' : "") +
            '</div>';
        } else {
          html += '<div class="field">' +
            '<label>' + title + reqStar + '</label>' +
            '<input type="text" data-field="' + propName + '" ' + reqAttr + ' placeholder="' + placeholder + '" value="' + defVal + '" />' +
            (desc ? '<span class="hint">' + desc + '</span>' : "") +
            (examples.length > 1 ? '<span class="hint">Examples: ' + examples.join(", ") + '</span>' : "") +
            '</div>';
        }
      }

      return html;
    }

    // ── Function: Add/Remove Environment Variable ───────────────────

    function addEnvVar() {
      const container = document.getElementById("envVarsContainer");
      const index = container.children.length;
      const html = \`
        <div class="repeatable-entry env-var-entry" data-index="\${index}">
          <div class="entry-header">
            <span class="entry-title">Variable #\${index + 1}</span>
            <button type="button" class="btn-remove" onclick="removeEnvVarEntry(this)">✕</button>
          </div>
          <div class="entry-fields">
            <div class="field-row">
              <div class="field">
                <label>Key<span class="req">*</span></label>
                <input type="text" data-field="envKey" required placeholder="MY_VAR" />
              </div>
              <div class="field">
                <label>Value</label>
                <input type="text" data-field="envValue" placeholder="value" />
              </div>
            </div>
          </div>
        </div>\`;
      container.insertAdjacentHTML("beforeend", html);
    }

    function removeEnvVarEntry(btn) {
      const entry = btn.closest(".repeatable-entry");
      const container = entry.parentElement;
      entry.remove();
      // Renumber remaining entries
      const entries = container.querySelectorAll(".repeatable-entry");
      entries.forEach((e, i) => {
        e.dataset.index = i;
        const title = e.querySelector(".entry-title");
        if (title) {
          title.textContent = "Variable #" + (i + 1);
        }
      });
    }

    // ── Form submission ─────────────────────────────────────────────

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorMsg.style.display = "none";

      const data = {};

      // Collect top-level named fields
      const topInputs = form.querySelectorAll(
        ":scope > .field input[name], :scope > .field textarea[name], :scope > .field select[name]," +
        ":scope > .field-row input[name], :scope > .field-row textarea[name], :scope > .field-row select[name]"
      );
      for (const el of topInputs) {
        if (el.type === "checkbox") {
          data[el.name] = el.checked;
        } else {
          data[el.name] = el.value;
        }
      }

      ${collectionCode}

      vscode.postMessage({ type: "submit", data });
    });
  </script>`;
}
