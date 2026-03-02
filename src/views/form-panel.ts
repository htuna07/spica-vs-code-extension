import * as vscode from "vscode";
import { ModuleType } from "../utils/constants.js";
import { SpicaTreeItem, NodeType } from "../models/tree-node.js";
import { SpicaTreeProvider } from "../providers/tree-provider.js";
import { showApiError, showSuccess } from "../utils/errors.js";

// API imports – creation
import { createBucket } from "../api/buckets.js";
import { insertBucketData } from "../api/bucket-data.js";
import { createFunction } from "../api/functions.js";
import { addFunctionDependencies } from "../api/functions.js";
import { createPolicy } from "../api/policies.js";
import { createEnvVar } from "../api/env-vars.js";
import { createSecret } from "../api/secrets.js";
import { getBucket } from "../api/buckets.js";

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

  // Bucket data → need the bucket schema to build the form
  if (
    moduleType === ModuleType.Buckets &&
    item.data.nodeType === NodeType.Resource &&
    resourceId
  ) {
    await openBucketDataForm(resourceId, treeProvider, extensionUri);
    return;
  }

  // Standard module-level add
  const formConfig = getFormConfig(moduleType);
  if (!formConfig) {
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "spicaForm",
    `New ${formConfig.title}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = buildFormHtml(
    formConfig.title,
    formConfig.fields,
    panel.webview,
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "submit") {
      try {
        await createResource(moduleType, msg.data);
        showSuccess(`${formConfig.title} created successfully`);
        treeProvider.refresh();
        panel.dispose();
      } catch (err) {
        showApiError(err, `Failed to create ${formConfig.title}`);
      }
    }
  });
}

// ── Dependency quick input ──────────────────────────────────────────

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

// ── Bucket data form (dynamic from schema) ──────────────────────────

async function openBucketDataForm(
  bucketId: string,
  treeProvider: SpicaTreeProvider,
  extensionUri: vscode.Uri,
): Promise<void> {
  let bucket;
  try {
    bucket = await getBucket(bucketId);
  } catch (err) {
    showApiError(err, "Failed to load bucket schema");
    return;
  }

  const fields: FormField[] = Object.entries(bucket.properties).map(
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

  panel.webview.html = buildFormHtml(
    `New Document — ${bucket.title}`,
    fields,
    panel.webview,
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === "submit") {
      try {
        // Convert types
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

// ── Form configurations ─────────────────────────────────────────────

interface FormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox" | "json" | "select";
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

interface FormConfig {
  title: string;
  fields: FormField[];
}

function getFormConfig(moduleType: ModuleType): FormConfig | null {
  switch (moduleType) {
    case ModuleType.Buckets:
      return {
        title: "Bucket",
        fields: [
          {
            name: "title",
            label: "Title",
            type: "text",
            required: true,
            placeholder: "My Bucket",
          },
          {
            name: "description",
            label: "Description",
            type: "text",
            required: true,
            placeholder: "A short description",
          },
          {
            name: "icon",
            label: "Icon",
            type: "text",
            placeholder: "view_stream",
          },
          {
            name: "properties",
            label: "Properties (JSON)",
            type: "json",
            required: true,
            placeholder: '{"field1": {"type": "string", "title": "Field 1"}}',
            defaultValue:
              '{\n  "title": {\n    "type": "string",\n    "title": "Title"\n  }\n}',
          },
          { name: "history", label: "Enable History", type: "checkbox" },
        ],
      };
    case ModuleType.Functions:
      return {
        title: "Function",
        fields: [
          {
            name: "name",
            label: "Name",
            type: "text",
            required: true,
            placeholder: "myFunction",
          },
          {
            name: "description",
            label: "Description",
            type: "text",
            placeholder: "Describe the function",
          },
          {
            name: "language",
            label: "Language",
            type: "select",
            required: true,
            options: [
              { label: "TypeScript", value: "typescript" },
              { label: "JavaScript", value: "javascript" },
            ],
          },
          {
            name: "timeout",
            label: "Timeout (seconds)",
            type: "number",
            required: true,
            defaultValue: "120",
          },
          {
            name: "triggers",
            label: "Triggers (JSON)",
            type: "json",
            required: true,
            placeholder:
              '{"default": {"type": "http", "active": true, "options": {"method": "Get", "path": "/my-endpoint"}}}',
            defaultValue:
              '{\n  "default": {\n    "type": "http",\n    "active": true,\n    "options": {\n      "method": "Get",\n      "path": "/my-endpoint"\n    }\n  }\n}',
          },
        ],
      };
    case ModuleType.Policies:
      return {
        title: "Policy",
        fields: [
          {
            name: "name",
            label: "Name",
            type: "text",
            required: true,
            placeholder: "MyPolicy",
          },
          {
            name: "description",
            label: "Description",
            type: "text",
            required: true,
            placeholder: "Policy description",
          },
          {
            name: "statement",
            label: "Statements (JSON array)",
            type: "json",
            required: true,
            placeholder:
              '[{"action": "bucket:index", "module": "bucket:data"}]',
            defaultValue:
              '[\n  {\n    "action": "bucket:index",\n    "module": "bucket:data"\n  }\n]',
          },
        ],
      };
    case ModuleType.EnvVars:
      return {
        title: "Environment Variable",
        fields: [
          {
            name: "key",
            label: "Key",
            type: "text",
            required: true,
            placeholder: "API_URL",
          },
          {
            name: "value",
            label: "Value",
            type: "text",
            required: true,
            placeholder: "https://...",
          },
        ],
      };
    case ModuleType.Secrets:
      return {
        title: "Secret",
        fields: [
          {
            name: "key",
            label: "Key",
            type: "text",
            required: true,
            placeholder: "DB_PASSWORD",
          },
          {
            name: "value",
            label: "Value",
            type: "text",
            required: true,
            placeholder: "s3cr3t",
          },
        ],
      };
    default:
      return null;
  }
}

// ── Create resource dispatch ────────────────────────────────────────

async function createResource(
  moduleType: ModuleType,
  data: Record<string, unknown>,
): Promise<void> {
  switch (moduleType) {
    case ModuleType.Buckets: {
      const props =
        typeof data.properties === "string"
          ? JSON.parse(data.properties as string)
          : data.properties;
      await createBucket({
        title: data.title as string,
        description: data.description as string,
        icon: (data.icon as string) || undefined,
        history: data.history === true || data.history === "true",
        properties: props,
      });
      return;
    }
    case ModuleType.Functions: {
      const triggers =
        typeof data.triggers === "string"
          ? JSON.parse(data.triggers as string)
          : data.triggers;
      await createFunction({
        name: data.name as string,
        description: (data.description as string) || undefined,
        language:
          (data.language as "typescript" | "javascript") || "typescript",
        timeout: Number(data.timeout) || 120,
        triggers,
      });
      return;
    }
    case ModuleType.Policies: {
      const statement =
        typeof data.statement === "string"
          ? JSON.parse(data.statement as string)
          : data.statement;
      await createPolicy({
        name: data.name as string,
        description: data.description as string,
        statement,
      });
      return;
    }
    case ModuleType.EnvVars:
      await createEnvVar({
        key: data.key as string,
        value: data.value as string,
      });
      return;
    case ModuleType.Secrets:
      await createSecret({
        key: data.key as string,
        value: data.value as string,
      });
      return;
  }
}

// ── Utility helpers ─────────────────────────────────────────────────

function mapBucketPropToInputType(propType?: string): FormField["type"] {
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
        result[key] = typeof val === "string" ? JSON.parse(val as string) : val;
        break;
      default:
        result[key] = val;
    }
  }
  return result;
}

// ── HTML builder ────────────────────────────────────────────────────

function buildFormHtml(
  title: string,
  fields: FormField[],
  _webview: vscode.Webview,
): string {
  const fieldHtml = fields
    .map((f) => {
      const reqAttr = f.required ? "required" : "";
      const reqStar = f.required ? '<span class="req">*</span>' : "";

      switch (f.type) {
        case "textarea":
        case "json":
          return `
            <div class="field">
              <label for="${f.name}">${f.label}${reqStar}</label>
              <textarea id="${f.name}" name="${f.name}" placeholder="${f.placeholder || ""}" rows="${f.type === "json" ? 8 : 4}" ${reqAttr}>${f.defaultValue || ""}</textarea>
            </div>`;
        case "checkbox":
          return `
            <div class="field checkbox">
              <label>
                <input type="checkbox" id="${f.name}" name="${f.name}" />
                ${f.label}
              </label>
            </div>`;
        case "number":
          return `
            <div class="field">
              <label for="${f.name}">${f.label}${reqStar}</label>
              <input type="number" id="${f.name}" name="${f.name}" placeholder="${f.placeholder || ""}" value="${f.defaultValue || ""}" ${reqAttr} />
            </div>`;
        case "select":
          return `
            <div class="field">
              <label for="${f.name}">${f.label}${reqStar}</label>
              <select id="${f.name}" name="${f.name}" ${reqAttr}>
                ${(f.options || [])
                  .map((o) => `<option value="${o.value}">${o.label}</option>`)
                  .join("")}
              </select>
            </div>`;
        default:
          return `
            <div class="field">
              <label for="${f.name}">${f.label}${reqStar}</label>
              <input type="text" id="${f.name}" name="${f.name}" placeholder="${f.placeholder || ""}" value="${f.defaultValue || ""}" ${reqAttr} />
            </div>`;
      }
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
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
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      padding: 24px;
      max-width: 640px;
      margin: 0 auto;
    }
    h1 {
      font-size: 1.4em;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .field {
      margin-bottom: 16px;
    }
    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .req { color: var(--error); margin-left: 2px; }
    input[type="text"],
    input[type="number"],
    textarea,
    select {
      width: 100%;
      padding: 6px 8px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 3px;
      font-family: inherit;
      font-size: inherit;
      box-sizing: border-box;
    }
    textarea { resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--focus);
    }
    .checkbox label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .actions {
      margin-top: 24px;
      display: flex;
      gap: 10px;
    }
    button {
      padding: 8px 20px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: inherit;
    }
    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .btn-primary:hover { background: var(--btn-hover); }
    .btn-secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--input-border);
    }
    .error-msg {
      color: var(--error);
      font-size: 0.9em;
      margin-top: 8px;
      display: none;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <form id="form">
    ${fieldHtml}
    <div id="errorMsg" class="error-msg"></div>
    <div class="actions">
      <button type="submit" class="btn-primary">Create</button>
    </div>
  </form>
  <script>
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

      // Validate JSON fields
      const jsonFields = form.querySelectorAll("textarea");
      for (const ta of jsonFields) {
        if (ta.value.trim()) {
          try {
            JSON.parse(ta.value);
          } catch (err) {
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
  </script>
</body>
</html>`;
}
