import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { ContractVersionSchema, Sha256Schema, TimestampSchema, canonicalIdSchema } from "./primitives.js";

const strict = { additionalProperties: false } as const;
const SemanticVersionSchema = Type.String({ pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$" });

export const HermesCapabilityNameSchema = Type.Union(
  [
    "profiles.read",
    "profiles.create",
    "profiles.update",
    "profiles.delete",
    "profiles.identity.read",
    "profiles.identity.update",
    "profiles.models.read",
    "profiles.models.update",
    "profiles.runtime.read",
    "profiles.runtime.control",
    "providers.read",
    "models.read",
    "usage.read",
    "conversations.respond",
    "conversations.stream",
    "schedules.read",
    "schedules.manage",
    "health.read",
  ].map((value) => Type.Literal(value)),
  { $id: "HermesCapabilityName" },
);

export const HermesCapabilityConstraintsSchema = Type.Object(
  {
    maximumBatchSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    maximumPayloadBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000_000 })),
    supportsIdempotency: Type.Boolean(),
    supportsExpectedVersion: Type.Boolean(),
    transports: Type.Array(Type.Union([Type.Literal("https"), Type.Literal("websocket"), Type.Literal("sse")]), { minItems: 1, uniqueItems: true }),
  },
  { $id: "HermesCapabilityConstraints", ...strict },
);

export const HermesCapabilityAdvertisementSchema = Type.Object(
  {
    name: HermesCapabilityNameSchema,
    version: SemanticVersionSchema,
    availability: Type.Union([Type.Literal("supported"), Type.Literal("temporarily-unavailable")]),
    operations: Type.Array(Type.Union([Type.Literal("read"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete"), Type.Literal("execute"), Type.Literal("subscribe")]), { minItems: 1, uniqueItems: true }),
    constraints: HermesCapabilityConstraintsSchema,
    unavailableReason: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  },
  { $id: "HermesCapabilityAdvertisement", ...strict },
);

export const HermesCapabilityDocumentSchema = Type.Object(
  {
    protocol: Type.Literal("hermes-control"),
    protocolVersion: Type.Literal("1.0.0"),
    frameworkId: canonicalIdSchema("framework"),
    frameworkInstance: Type.String({ minLength: 1, maxLength: 500 }),
    frameworkVersion: SemanticVersionSchema,
    documentVersion: Type.Integer({ minimum: 1 }),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    schemaDigest: Sha256Schema,
    capabilities: Type.Array(HermesCapabilityAdvertisementSchema, { minItems: 1, maxItems: 200 }),
  },
  { $id: "HermesCapabilityDocument", ...strict },
);

export const CapabilityRequirementSchema = Type.Object(
  {
    name: HermesCapabilityNameSchema,
    minimumVersion: SemanticVersionSchema,
    requiredOperations: Type.Array(Type.Union([Type.Literal("read"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete"), Type.Literal("execute"), Type.Literal("subscribe")]), { minItems: 1, uniqueItems: true }),
    required: Type.Boolean(),
  },
  { $id: "CapabilityRequirement", ...strict },
);

export const CapabilityNegotiationRequestSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    frameworkId: canonicalIdSchema("framework"),
    requestedAt: TimestampSchema,
    requirements: Type.Array(CapabilityRequirementSchema, { minItems: 1, maxItems: 200 }),
    advertisement: HermesCapabilityDocumentSchema,
  },
  { $id: "CapabilityNegotiationRequest", ...strict },
);

export const NegotiatedCapabilitySchema = Type.Object(
  {
    name: HermesCapabilityNameSchema,
    version: SemanticVersionSchema,
    operations: Type.Array(Type.Union([Type.Literal("read"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete"), Type.Literal("execute"), Type.Literal("subscribe")]), { minItems: 1, uniqueItems: true }),
    constraints: HermesCapabilityConstraintsSchema,
  },
  { $id: "NegotiatedCapability", ...strict },
);

export const CapabilityRejectionSchema = Type.Object(
  {
    name: HermesCapabilityNameSchema,
    code: Type.Union([Type.Literal("not-advertised"), Type.Literal("temporarily-unavailable"), Type.Literal("version-incompatible"), Type.Literal("operation-missing"), Type.Literal("constraint-incompatible")]),
    message: Type.String({ minLength: 1, maxLength: 1_000 }),
    required: Type.Boolean(),
  },
  { $id: "CapabilityRejection", ...strict },
);

export const CapabilityNegotiationResultSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    frameworkId: canonicalIdSchema("framework"),
    status: Type.Union([Type.Literal("accepted"), Type.Literal("degraded"), Type.Literal("rejected")]),
    negotiatedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    advertisementDigest: Sha256Schema,
    effectiveCapabilities: Type.Array(NegotiatedCapabilitySchema, { maxItems: 200 }),
    rejections: Type.Array(CapabilityRejectionSchema, { maxItems: 200 }),
  },
  { $id: "CapabilityNegotiationResult", ...strict },
);

export interface CapabilityRequirement {
  readonly name: Static<typeof HermesCapabilityNameSchema>;
  readonly minimumVersion: string;
  readonly requiredOperations: readonly string[];
  readonly required: boolean;
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): readonly number[] => value.split("-", 1)[0]!.split(".").map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type CapabilityDocument = Static<typeof HermesCapabilityDocumentSchema>;
export type CapabilityNegotiationResult = Static<typeof CapabilityNegotiationResultSchema>;

export function negotiateCapabilities(
  document: CapabilityDocument,
  requirements: readonly CapabilityRequirement[],
  negotiatedAt: string,
): CapabilityNegotiationResult {
  const advertisements = new Map(document.capabilities.map((capability) => [capability.name, capability]));
  const effectiveCapabilities: Array<Static<typeof NegotiatedCapabilitySchema>> = [];
  const rejections: Array<Static<typeof CapabilityRejectionSchema>> = [];

  for (const requirement of requirements) {
    const advertised = advertisements.get(requirement.name);
    if (!advertised) {
      rejections.push({ name: requirement.name, code: "not-advertised", message: "Capability was not advertised by the framework.", required: requirement.required });
      continue;
    }
    if (advertised.availability !== "supported") {
      rejections.push({ name: requirement.name, code: "temporarily-unavailable", message: advertised.unavailableReason ?? "Capability is temporarily unavailable.", required: requirement.required });
      continue;
    }
    if (compareSemver(advertised.version, requirement.minimumVersion) < 0) {
      rejections.push({ name: requirement.name, code: "version-incompatible", message: `Requires ${requirement.minimumVersion} or newer.`, required: requirement.required });
      continue;
    }
    if (requirement.requiredOperations.some((operation) => !advertised.operations.includes(operation as never))) {
      rejections.push({ name: requirement.name, code: "operation-missing", message: "One or more required operations were not advertised.", required: requirement.required });
      continue;
    }
    effectiveCapabilities.push({
      name: advertised.name,
      version: advertised.version,
      operations: advertised.operations,
      constraints: advertised.constraints,
    });
  }

  const requiredRejected = rejections.some((rejection) => rejection.required);
  return {
    contractVersion: "core.v1",
    frameworkId: document.frameworkId,
    status: requiredRejected ? "rejected" : rejections.length > 0 ? "degraded" : "accepted",
    negotiatedAt,
    expiresAt: document.expiresAt,
    advertisementDigest: document.schemaDigest,
    effectiveCapabilities,
    rejections,
  };
}

export const CapabilitySchemas: Record<string, TSchema> = {
  HermesCapabilityName: HermesCapabilityNameSchema,
  HermesCapabilityConstraints: HermesCapabilityConstraintsSchema,
  HermesCapabilityAdvertisement: HermesCapabilityAdvertisementSchema,
  HermesCapabilityDocument: HermesCapabilityDocumentSchema,
  CapabilityRequirement: CapabilityRequirementSchema,
  CapabilityNegotiationRequest: CapabilityNegotiationRequestSchema,
  NegotiatedCapability: NegotiatedCapabilitySchema,
  CapabilityRejection: CapabilityRejectionSchema,
  CapabilityNegotiationResult: CapabilityNegotiationResultSchema,
};
