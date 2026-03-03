export const EXTENSION_ID = "spica";
export const SPICA_SCHEME = "spica";
export const VIEW_WELCOME = "spicaWelcome";
export const VIEW_EXPLORER = "spicaExplorer";

export const CONTEXT_CONNECTED = "spica:connected";

export const STATE_KEY_SERVER_URL = "spica.serverUrl";
export const STATE_KEY_AUTH_SCHEME = "spica.authScheme";

export const SECRET_KEY_TOKEN = "spica.token";
export const SECRET_KEY_APIKEY = "spica.apiKey";
export const SECRET_KEY_IDENTIFIER = "spica.identifier";
export const SECRET_KEY_PASSWORD = "spica.password";

export type AuthScheme = "APIKEY" | "IDENTITY";

export enum ModuleType {
  Buckets = "buckets",
  Functions = "functions",
  Policies = "policies",
}

export const MODULE_LABELS: Record<ModuleType, string> = {
  [ModuleType.Buckets]: "Buckets",
  [ModuleType.Functions]: "Functions",
  [ModuleType.Policies]: "Policies",
};

export const MODULE_ICONS: Record<ModuleType, string> = {
  [ModuleType.Buckets]: "database",
  [ModuleType.Functions]: "symbol-function",
  [ModuleType.Policies]: "shield",
};
