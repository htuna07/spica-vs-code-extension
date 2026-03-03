# Spica VS Code Extension

> Manage your Spica backend resources (Buckets, Functions, Policies) from inside VS Code.

## Overview

This extension provides a tree-based explorer, editors and webviews to manage a Spica backend. Key capabilities:

- Connect to a Spica server using API Key or Identity (username/password).
- Browse and manage Buckets, Functions and Policies in a sidebar tree view.
- Edit resources (structured forms or raw JSON) and persist changes back to the server.
- Edit function source code with TypeScript/JavaScript language support.
- Manage function dependencies (install/remove npm packages).
- Stream function logs to the Output Channel.
- Auto-reconnect on VS Code restart using secure storage for credentials.

## Installation

- Install from the VS Code Marketplace (when published) or build a VSIX locally.

Local packaging example:

```bash
npm run build
yes | npx --yes @vscode/vsce package --allow-missing-repository
```

## Quick Start

1. Open the Activity Bar and click the **Spica** icon.
2. Run the `Connect to Spica` command.
3. Enter your Spica server URL (e.g. `https://my-spica.example.com`).
4. Choose authentication method and provide credentials.
5. After connecting, use the Explorer to browse, edit, create or delete resources.

## Commands

The extension contributes these commands (use Cmd/Ctrl+Shift+P or the tree view context menu):

- `spica.connect` — Connect to a Spica server
- `spica.disconnect` — Disconnect from the current Spica server
- `spica.refresh` — Refresh a node or the entire explorer
- `spica.addResource` — Create a new resource
- `spica.editResource` — Edit the selected resource (form or raw)
- `spica.openJsonEditor` — Open raw JSON editor for a resource
- `spica.deleteResource` — Delete a resource (with confirmation)
- `spica.openResource` — Open a resource in editor
- `spica.viewLogs` — Show function logs
- `spica.editEnvVar` — Edit environment variables for functions

## Explorer Structure

Top-level modules: `Buckets`, `Functions`, `Policies`.

- Buckets: expand to view documents and bucket schema; edit or delete schemas.
- Functions: expand to edit source, view/modify dependencies, and open logs.
- Policies: open and edit policy definitions.

Context menus and inline actions provide quick operations such as refresh, add, edit and delete.

## Development

Prerequisites: Node.js, npm

Development run:

```bash
npm install
npm run watch    # runs esbuild in watch mode
# In VS Code: press F5 to launch the Extension Development Host
```

Build for publishing:

```bash
npm run build
```

Notes:

- Source is TypeScript and compiled with `esbuild` (see `esbuild.js`).
- Entry point used by VS Code is `./dist/extension.js` (built from `src/`).

## Contributing

Contributions are welcome. Please open issues or PRs for bugs and feature requests. Follow the repository style (TypeScript + esbuild).

## Troubleshooting

- If the tree view does not appear, ensure the extension is activated and check the `Spica` activity bar icon.
- For build problems, run `npm run build` and check `esbuild.js` output.

## License

This project is licensed under AGPL-3.0.

---

For implementation details, see the source in the `src/` directory (commands, providers, views, and storage).
