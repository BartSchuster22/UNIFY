import { Type, type Static, type TSchema } from "@sinclair/typebox";

export const CONTRACT_VERSION = "core.v1" as const;
export const HERMES_PROTOCOL = "hermes-control" as const;
export const HERMES_PROTOCOL_VERSION = "1.0.0" as const;

export const CANONICAL_ID_PREFIXES = {
  user: "usr",
  session: "ses",
  service: "svc",
  credential: "crd",
  mfaEnrollment: "mfa",
  command: "cmd",
  request: "req",
  correlation: "cor",
  framework: "frm",
  profile: "prf",
  provider: "pvd",
  model: "mdl",
  project: "prj",
  board: "brd",
  task: "tsk",
  comment: "cmt",
  schedule: "sch",
  run: "run",
  conversation: "cvs",
  message: "msg",
  attachment: "att",
  channel: "chn",
  notification: "ntf",
  operation: "opc",
  audit: "aud",
  event: "evt",
} as const;

export type CanonicalIdKind = keyof typeof CANONICAL_ID_PREFIXES;
export type CanonicalId = `${(typeof CANONICAL_ID_PREFIXES)[CanonicalIdKind]}_${string}`;

const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";
const prefixes = Object.values(CANONICAL_ID_PREFIXES).join("|");
export const CANONICAL_ID_PATTERN = `^(?:${prefixes})_${ULID_PATTERN}$`;

export const ContractVersionSchema = Type.Literal(CONTRACT_VERSION, { $id: "ContractVersion" });
export const CanonicalIdSchema = Type.String({
  $id: "CanonicalId",
  pattern: CANONICAL_ID_PATTERN,
  description: "A resource-kind prefix followed by an uppercase Crockford ULID.",
});
export const TimestampSchema = Type.String({ $id: "Timestamp", format: "date-time" });
export const ResourceVersionSchema = Type.Integer({ $id: "ResourceVersion", minimum: 1 });
export const NonEmptyTextSchema = Type.String({ $id: "NonEmptyText", minLength: 1, maxLength: 10_000 });
export const SlugSchema = Type.String({ $id: "Slug", pattern: "^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$" });
export const CursorSchema = Type.String({ $id: "Cursor", minLength: 1, maxLength: 512 });
export const IdempotencyKeySchema = Type.String({
  $id: "IdempotencyKey",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$",
});
export const Sha256Schema = Type.String({ $id: "Sha256", pattern: "^[a-f0-9]{64}$" });

export function canonicalIdPattern(kind: CanonicalIdKind): string {
  return `^${CANONICAL_ID_PREFIXES[kind]}_${ULID_PATTERN}$`;
}

export function canonicalIdSchema(kind: CanonicalIdKind): TSchema {
  return Type.String({ pattern: canonicalIdPattern(kind) });
}

export function isCanonicalId(value: unknown, kind?: CanonicalIdKind): value is CanonicalId {
  if (typeof value !== "string") return false;
  const pattern = kind
    ? new RegExp(`^${CANONICAL_ID_PREFIXES[kind]}_${ULID_PATTERN}$`)
    : new RegExp(CANONICAL_ID_PATTERN);
  return pattern.test(value);
}

export const PageMetaSchema = Type.Object(
  {
    nextCursor: Type.Union([CursorSchema, Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { $id: "PageMeta", additionalProperties: false },
);

export const ResourceMetaSchema = Type.Object(
  {
    id: CanonicalIdSchema,
    version: ResourceVersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { $id: "ResourceMeta", additionalProperties: false },
);

export type ResourceMeta = Static<typeof ResourceMetaSchema>;
