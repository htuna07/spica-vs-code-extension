# Spica VS Code Extension

Manage your [Spica](https://spicaengine.com/) backend engine resources directly from VS Code.

## Features

- **Connect** to any Spica server via API Key or Identity (username/password) authentication
- **Browse** all resources in a sidebar tree view: Buckets, Functions, Policies, Environment Variables, Secrets
- **Open & Edit** any resource directly in the VS Code editor — save to update on the server
- **Create** new resources via intuitive webview forms
- **Delete** resources with confirmation dialog
- **Function source code** editing with full TypeScript/JavaScript language support
- **Dependency management** for Functions (install/remove npm packages)
- **Function logs** streamed to an Output Channel with clear support
- **Auto-reconnect** on VS Code restart using securely stored credentials

## Getting Started

1. Install the extension
2. Click the **Spica** icon in the Activity Bar (left sidebar)
3. Click **Connect to Spica**
4. Enter your Spica server URL (e.g. `https://my-spica.example.com`)
5. Choose authentication method (API Key or Identity)
6. Enter your credentials — you're connected!

## Tree View Structure

```
Buckets
├── My Bucket           → expand to list documents, three-dot to edit/delete schema
│   ├── doc-abc123      → click to open, three-dot to delete
│   └── ...
Functions
├── myFunction          → expand to see source & deps, three-dot to edit/delete/view logs
│   ├── Source Code     → click to edit function code
│   └── Dependencies   → expand to see packages, + to install new
│       ├── axios@1.6.0
│       └── ...
Policies
├── AdminPolicy         → click to edit, three-dot to delete
Environment Variables
├── API_URL             → click to edit, three-dot to delete
Secrets
├── DB_PASSWORD         → click to edit, three-dot to delete
```

## Inline & Context Menu Actions

| Icon        | Action                       | Appears on                           |
| ----------- | ---------------------------- | ------------------------------------ |
| ↻ (Refresh) | Reload children              | Module & resource nodes              |
| + (Add)     | Create new resource          | Module nodes, Dependencies           |
| Edit        | Open resource in editor      | Resource nodes (three-dot menu)      |
| Delete      | Delete with confirmation     | All deletable nodes (three-dot menu) |
| View Logs   | Show function execution logs | Function nodes (three-dot menu)      |

## Development

```bash
npm install
npm run watch   # esbuild watch mode
# Press F5 to launch Extension Development Host
```

## Building

```bash
npm run build
```

## License

AGPL-3.0
