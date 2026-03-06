// ---------------------------------------------------------------------------
// TypeScript interfaces derived from the Spica OpenAPI specification
// ---------------------------------------------------------------------------

// ── Auth ──────────────────────────────────────────────────────────────────

export interface LoginCredentials {
  identifier: string;
  password: string;
  state?: string;
  expires?: number;
}

export interface TokenResponse {
  token: string;
  issuer: string;
  schema: string;
}

// ── Error ─────────────────────────────────────────────────────────────────

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
}

// ── Pagination ────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
}

export interface PaginatedResponse<T> {
  meta: PaginationMeta;
  data: T[];
}

// ── Policy ────────────────────────────────────────────────────────────────

export interface PolicyStatement {
  action: string;
  module: string;
  resource?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface Policy {
  _id: string;
  name: string;
  description: string;
  statement: PolicyStatement[];
}

export interface PolicyInput {
  name: string;
  description: string;
  statement: PolicyStatement[];
}

// ── Bucket ────────────────────────────────────────────────────────────────

export interface BucketAcl {
  write: string;
  read: string;
}

export interface BucketIndex {
  definition: Record<string, number | string>;
  options?: Record<string, unknown>;
}

export interface BucketDocumentSettings {
  countLimit?: number;
  limitExceedBehaviour?: "prevent" | "remove";
}

export type BucketPropertyType =
  | "array"
  | "multiselect"
  | "boolean"
  | "number"
  | "object"
  | "string"
  | "storage"
  | "richtext"
  | "date"
  | "textarea"
  | "color"
  | "relation"
  | "location"
  | "json"
  | "hash"
  | "encrypted";

export interface BucketProperty {
  title?: string;
  description?: string;
  type?: BucketPropertyType;
  default?: unknown;
  readOnly?: boolean;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: BucketProperty;
  properties?: Record<string, BucketProperty>;
  required?: string[];
  bucketId?: string;
  relationType?: "onetoone" | "onetomany";
  dependent?: boolean;
  locationType?: "Point";
  options?: {
    translate?: boolean;
    history?: boolean;
  };
}

export interface Bucket {
  _id: string;
  title: string;
  description: string;
  icon?: string;
  primary?: string;
  order?: number;
  category?: string;
  readOnly?: boolean;
  history?: boolean;
  required?: string[];
  acl?: BucketAcl;
  indexes?: BucketIndex[];
  documentSettings?: BucketDocumentSettings;
  properties: Record<string, BucketProperty>;
}

export interface BucketInput {
  title: string;
  description: string;
  icon?: string;
  primary?: string;
  order?: number;
  category?: string;
  readOnly?: boolean;
  history?: boolean;
  required?: string[];
  acl?: BucketAcl;
  indexes?: BucketIndex[];
  documentSettings?: BucketDocumentSettings;
  properties: Record<string, BucketProperty>;
}

// ── Bucket Data ───────────────────────────────────────────────────────────

export type BucketDocument = Record<string, unknown> & { _id: string };

// ── Function ──────────────────────────────────────────────────────────────

export interface FunctionTrigger {
  type: string;
  active: boolean;
  options?: Record<string, unknown>;
}

export interface SpicaFunction {
  _id: string;
  name: string;
  description?: string;
  language: "typescript" | "javascript";
  timeout: number;
  triggers: Record<string, FunctionTrigger>;
  env_vars?: string[];
  secrets?: string[];
  category?: string;
  order?: number;
}

export interface FunctionInput {
  name: string;
  description?: string;
  language: "typescript" | "javascript";
  timeout: number;
  triggers: Record<string, FunctionTrigger>;
  env?: Record<string, string>;
  category?: string;
  order?: number;
}

export interface FunctionLog {
  _id: string;
  function: string;
  event_id: string;
  channel: string;
  content: string;
  created_at: string;
  level: number;
}

// ── Function Information (dynamic runtime data) ───────────────────────────

export interface FunctionEnqueuerDescription {
  icon: string;
  name: string;
  title: string;
  description: string;
}

export interface FunctionEnqueuerOptionProperty {
  title?: string;
  description?: string;
  type: string;
  enum?: string[];
  viewEnum?: string[];
  default?: unknown;
  examples?: string[];
  pattern?: string;
}

export interface FunctionEnqueuerOptions {
  $id?: string;
  title?: string;
  description?: string;
  type: string;
  required?: string[];
  properties: Record<string, FunctionEnqueuerOptionProperty>;
  additionalProperties?: boolean;
}

export interface FunctionEnqueuer {
  description: FunctionEnqueuerDescription;
  options: FunctionEnqueuerOptions;
}

export interface FunctionRuntime {
  name: string;
  title: string;
  description: string;
}

export interface FunctionInformation {
  enqueuers: FunctionEnqueuer[];
  runtimes: FunctionRuntime[];
  timeout: number;
}

// ── Environment Variables ─────────────────────────────────────────────────

export interface EnvVar {
  _id: string;
  key: string;
  value: string;
}

export interface EnvVarInput {
  key: string;
  value: string;
}

// ── Secrets ───────────────────────────────────────────────────────────────

export interface Secret {
  _id: string;
  key: string;
  value: string;
}

export interface SecretInput {
  key: string;
  value: string;
}
