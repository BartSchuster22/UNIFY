import { Type, type TSchema } from "@sinclair/typebox";
import { commandEnvelopeSchema } from "./envelopes.js";
import {
  CanonicalIdSchema,
  ContractVersionSchema,
  CursorSchema,
  NonEmptyTextSchema,
  PageMetaSchema,
  ResourceMetaSchema,
  ResourceVersionSchema,
  Sha256Schema,
  SlugSchema,
  TimestampSchema,
  canonicalIdSchema,
} from "./primitives.js";

const strict = { additionalProperties: false } as const;
const Label = Type.String({ minLength: 1, maxLength: 200 });
const OptionalDescription = Type.Optional(Type.String({ maxLength: 5_000 }));
const StringMap = Type.Record(Type.String({ pattern: "^[a-z][a-z0-9._-]{0,99}$" }), Type.String({ maxLength: 2_000 }));
const StringArray = Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 200, uniqueItems: true });
const ResourceState = Type.Union([Type.Literal("active"), Type.Literal("inactive"), Type.Literal("archived")]);

export const LoginInputSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 128 }),
    password: Type.String({ minLength: 12, maxLength: 1_024 }),
    mfaCode: Type.Optional(Type.String({ pattern: "^[0-9]{6,8}$" })),
  },
  { $id: "LoginInput", ...strict },
);

export const PrincipalSchema = Type.Object(
  {
    contractVersion: ContractVersionSchema,
    id: canonicalIdSchema("user"),
    username: Type.String({ minLength: 1, maxLength: 128 }),
    displayName: Label,
    roles: StringArray,
    permissions: StringArray,
    mfaVerified: Type.Boolean(),
  },
  { $id: "Principal", ...strict },
);

export const IdentitySessionSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    userId: canonicalIdSchema("user"),
    createdAt: TimestampSchema,
    lastSeenAt: TimestampSchema,
    expiresAt: TimestampSchema,
    revokedAt: Type.Union([TimestampSchema, Type.Null()]),
    deviceLabel: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  },
  { $id: "IdentitySession", ...strict },
);

export const PasswordChangeInputSchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: 12, maxLength: 1_024 }),
    newPassword: Type.String({ minLength: 16, maxLength: 1_024 }),
    revokeOtherSessions: Type.Boolean(),
  },
  { $id: "PasswordChangeInput", ...strict },
);

export const MfaEnrollmentStartInputSchema = Type.Object(
  { password: Type.String({ minLength: 12, maxLength: 1_024 }) },
  { $id: "MfaEnrollmentStartInput", ...strict },
);

export const MfaEnrollmentChallengeSchema = Type.Object(
  {
    enrollmentId: canonicalIdSchema("mfaEnrollment"),
    provisioningUri: Type.String({ pattern: "^otpauth://totp/", maxLength: 4_096 }),
    recoveryCodes: Type.Array(Type.String({ pattern: "^[A-Z0-9-]{8,32}$" }), { minItems: 8, maxItems: 20, uniqueItems: true }),
    expiresAt: TimestampSchema,
  },
  { $id: "MfaEnrollmentChallenge", ...strict },
);

export const MfaEnrollmentConfirmInputSchema = Type.Object(
  {
    enrollmentId: canonicalIdSchema("mfaEnrollment"),
    code: Type.String({ pattern: "^[0-9]{6,8}$" }),
  },
  { $id: "MfaEnrollmentConfirmInput", ...strict },
);

export const MfaRemovalInputSchema = Type.Object(
  {
    password: Type.String({ minLength: 12, maxLength: 1_024 }),
    code: Type.String({ pattern: "^(?:[0-9]{6,8}|[A-Z0-9-]{8,32})$" }),
  },
  { $id: "MfaRemovalInput", ...strict },
);

export const ServiceCredentialSchema = Type.Object(
  {
    id: canonicalIdSchema("credential"),
    serviceId: canonicalIdSchema("service"),
    label: Label,
    scopes: StringArray,
    createdAt: TimestampSchema,
    expiresAt: Type.Union([TimestampSchema, Type.Null()]),
    revokedAt: Type.Union([TimestampSchema, Type.Null()]),
    lastUsedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "ServiceCredential", ...strict },
);

export const ServiceCredentialListSchema = listSchema("ServiceCredentialList", ServiceCredentialSchema);

export const ServiceCredentialCreateInputSchema = Type.Object(
  {
    serviceId: canonicalIdSchema("service"),
    label: Label,
    scopes: StringArray,
    expiresAt: Type.Optional(TimestampSchema),
  },
  { $id: "ServiceCredentialCreateInput", ...strict },
);

export const ServiceCredentialIssuedSchema = Type.Object(
  {
    credential: ServiceCredentialSchema,
    token: Type.String({ minLength: 32, maxLength: 4_096 }),
  },
  { $id: "ServiceCredentialIssued", ...strict },
);

export const FrameworkSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    name: Label,
    endpoint: Type.String({ format: "uri", maxLength: 2_048 }),
    credentialReference: Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 }),
    state: ResourceState,
    protocol: Type.Literal("hermes-control"),
    requiredProtocolVersion: Type.Literal("1.0.0"),
    lastObservedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "Framework", ...strict },
);

export const ProfileSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    frameworkId: canonicalIdSchema("framework"),
    nativeReference: Type.String({ minLength: 1, maxLength: 500 }),
    name: Label,
    description: Type.Union([Type.String({ maxLength: 5_000 }), Type.Null()]),
    state: ResourceState,
    protected: Type.Boolean(),
    observedVersion: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    lastObservedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "Profile", ...strict },
);

export const ProviderSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    frameworkId: canonicalIdSchema("framework"),
    nativeReference: Type.String({ minLength: 1, maxLength: 500 }),
    name: Label,
    authenticationMethod: Type.Union([
      Type.Literal("none"),
      Type.Literal("api-key"),
      Type.Literal("oauth2"),
      Type.Literal("framework-managed"),
    ]),
    credentialState: Type.Union([Type.Literal("not-required"), Type.Literal("missing"), Type.Literal("configured"), Type.Literal("invalid")]),
    state: ResourceState,
    lastValidatedAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "Provider", ...strict },
);

export const ModelSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    providerId: canonicalIdSchema("provider"),
    nativeReference: Type.String({ minLength: 1, maxLength: 500 }),
    name: Label,
    state: ResourceState,
    contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    maximumOutputTokens: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    capabilities: Type.Array(Type.Union([
      Type.Literal("text"),
      Type.Literal("vision"),
      Type.Literal("audio"),
      Type.Literal("tool-use"),
      Type.Literal("structured-output"),
      Type.Literal("reasoning"),
    ]), { uniqueItems: true }),
    observedAt: TimestampSchema,
  },
  { $id: "Model", ...strict },
);

export const ProjectSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    slug: SlugSchema,
    name: Label,
    goal: Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()]),
    state: Type.Union([
      Type.Literal("saved"),
      Type.Literal("scheduled"),
      Type.Literal("active"),
      Type.Literal("paused"),
      Type.Literal("finished"),
      Type.Literal("reflected"),
      Type.Literal("archived"),
    ]),
    profileIds: Type.Array(canonicalIdSchema("profile"), { maxItems: 100, uniqueItems: true }),
    projectManagerProfileId: Type.Union([canonicalIdSchema("profile"), Type.Null()]),
    workspaceReference: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
  },
  { $id: "Project", ...strict },
);

export const BoardSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    projectId: canonicalIdSchema("project"),
    name: Label,
    lanes: Type.Array(Type.Object({ key: SlugSchema, label: Label, position: Type.Integer({ minimum: 0 }) }, strict), { minItems: 1, maxItems: 50 }),
    quarantined: Type.Boolean(),
  },
  { $id: "Board", ...strict },
);

export const TaskSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    projectId: canonicalIdSchema("project"),
    boardId: canonicalIdSchema("board"),
    lane: SlugSchema,
    title: Label,
    description: Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]),
    priority: Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("urgent")]),
    state: Type.Union([Type.Literal("open"), Type.Literal("running"), Type.Literal("blocked"), Type.Literal("completed"), Type.Literal("archived")]),
    assigneeProfileId: Type.Union([canonicalIdSchema("profile"), Type.Null()]),
    lastHeartbeatAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "Task", ...strict },
);

export const TaskCommentSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    taskId: canonicalIdSchema("task"),
    authorId: Type.Union([canonicalIdSchema("user"), canonicalIdSchema("service"), canonicalIdSchema("profile")]),
    body: NonEmptyTextSchema,
    evidenceReferences: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 100 }),
  },
  { $id: "TaskComment", ...strict },
);

export const WorkScheduleSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    projectId: canonicalIdSchema("project"),
    kind: Type.Union([Type.Literal("at"), Type.Literal("every"), Type.Literal("cron")]),
    expression: Type.String({ minLength: 1, maxLength: 200 }),
    timezone: Type.String({ minLength: 1, maxLength: 100 }),
    enabled: Type.Boolean(),
    nextRunAt: Type.Union([TimestampSchema, Type.Null()]),
  },
  { $id: "WorkSchedule", ...strict },
);

export const WorkRunSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    projectId: canonicalIdSchema("project"),
    scheduleId: Type.Union([canonicalIdSchema("schedule"), Type.Null()]),
    state: Type.Union([Type.Literal("queued"), Type.Literal("running"), Type.Literal("blocked"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("cancelled")]),
    startedAt: Type.Union([TimestampSchema, Type.Null()]),
    finishedAt: Type.Union([TimestampSchema, Type.Null()]),
    evidenceReferences: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 200 }),
  },
  { $id: "WorkRun", ...strict },
);

export const ConversationAgentSchema = Type.Object(
  {
    profileId: canonicalIdSchema("profile"),
    frameworkId: canonicalIdSchema("framework"),
    label: Label,
    state: ResourceState,
  },
  { $id: "ConversationAgent", ...strict },
);

export const ConversationSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    profileId: canonicalIdSchema("profile"),
    title: Label,
    state: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    ownership: Type.Union([Type.Literal("core"), Type.Literal("external")]),
    channelId: Type.Union([canonicalIdSchema("channel"), Type.Null()]),
    externalConversationReference: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
    lastSequence: Type.Integer({ minimum: 0 }),
  },
  { $id: "Conversation", ...strict },
);

export const MessageBlockSchema = Type.Union([
  Type.Object({ kind: Type.Literal("text"), text: Type.String({ minLength: 1, maxLength: 100_000 }) }, strict),
  Type.Object({ kind: Type.Literal("attachment"), attachmentId: canonicalIdSchema("attachment"), caption: Type.Optional(Type.String({ maxLength: 5_000 })) }, strict),
]);

export const MessageSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    conversationId: canonicalIdSchema("conversation"),
    sender: Type.Union([Type.Literal("user"), Type.Literal("profile"), Type.Literal("system")]),
    sequence: Type.Integer({ minimum: 1 }),
    state: Type.Union([Type.Literal("accepted"), Type.Literal("streaming"), Type.Literal("complete"), Type.Literal("failed")]),
    blocks: Type.Array(MessageBlockSchema, { minItems: 1, maxItems: 100 }),
  },
  { $id: "Message", ...strict },
);

export const AttachmentSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    filename: Type.String({ minLength: 1, maxLength: 255 }),
    mediaType: Type.String({ pattern: "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$", maxLength: 200 }),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 52_428_800 }),
    sha256: Sha256Schema,
    state: Type.Union([Type.Literal("pending"), Type.Literal("available"), Type.Literal("rejected")]),
  },
  { $id: "Attachment", ...strict },
);

export const ChannelSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    profileId: canonicalIdSchema("profile"),
    kind: Type.Union([Type.Literal("telegram"), Type.Literal("whatsapp"), Type.Literal("custom")]),
    label: Label,
    state: ResourceState,
    secretReference: Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 }),
    externalIdentity: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    sessionPolicy: Type.Union([Type.Literal("per-external-conversation"), Type.Literal("single-channel-conversation")]),
  },
  { $id: "Channel", ...strict },
);

export const NotificationSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error"), Type.Literal("critical")]),
    state: Type.Union([Type.Literal("unread"), Type.Literal("read"), Type.Literal("acknowledged")]),
    title: Label,
    body: Type.String({ minLength: 1, maxLength: 10_000 }),
    subjectId: Type.Union([CanonicalIdSchema, Type.Null()]),
    channelId: Type.Union([canonicalIdSchema("channel"), Type.Null()]),
  },
  { $id: "Notification", ...strict },
);

export const OperationSchema = Type.Object(
  {
    meta: ResourceMetaSchema,
    commandId: canonicalIdSchema("command"),
    commandType: Type.String({ pattern: "^[a-z][a-z0-9.-]+\\.v1$" }),
    state: Type.Union([Type.Literal("accepted"), Type.Literal("validating"), Type.Literal("executing"), Type.Literal("verifying"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("cancelled")]),
    targetId: Type.Union([CanonicalIdSchema, Type.Null()]),
    attempt: Type.Integer({ minimum: 0 }),
    retryable: Type.Boolean(),
    safeSummary: Type.Union([Type.String({ maxLength: 5_000 }), Type.Null()]),
  },
  { $id: "Operation", ...strict },
);

export const AuditRecordSchema = Type.Object(
  {
    id: canonicalIdSchema("audit"),
    sequence: Type.Integer({ minimum: 1 }),
    eventType: Type.String({ pattern: "^[a-z][a-z0-9.-]+\\.v1$" }),
    actorId: Type.Union([canonicalIdSchema("user"), canonicalIdSchema("service")]),
    subjectId: Type.Union([CanonicalIdSchema, Type.Null()]),
    operationId: Type.Union([canonicalIdSchema("operation"), Type.Null()]),
    outcome: Type.Union([Type.Literal("allowed"), Type.Literal("denied"), Type.Literal("succeeded"), Type.Literal("failed")]),
    occurredAt: TimestampSchema,
    previousHash: Type.Union([Sha256Schema, Type.Null()]),
    recordHash: Sha256Schema,
    safeMetadata: StringMap,
  },
  { $id: "AuditRecord", ...strict },
);

function listSchema(id: string, item: TSchema): TSchema {
  return Type.Object({ items: Type.Array(item), page: PageMetaSchema }, { $id: id, ...strict });
}

export const IdentitySessionListSchema = listSchema("IdentitySessionList", IdentitySessionSchema);
export const FrameworkListSchema = listSchema("FrameworkList", FrameworkSchema);
export const ProfileListSchema = listSchema("ProfileList", ProfileSchema);
export const ProviderListSchema = listSchema("ProviderList", ProviderSchema);
export const ModelListSchema = listSchema("ModelList", ModelSchema);
export const ProjectListSchema = listSchema("ProjectList", ProjectSchema);
export const BoardListSchema = listSchema("BoardList", BoardSchema);
export const TaskListSchema = listSchema("TaskList", TaskSchema);
export const TaskCommentListSchema = listSchema("TaskCommentList", TaskCommentSchema);
export const WorkScheduleListSchema = listSchema("WorkScheduleList", WorkScheduleSchema);
export const WorkRunListSchema = listSchema("WorkRunList", WorkRunSchema);
export const ConversationAgentListSchema = listSchema("ConversationAgentList", ConversationAgentSchema);
export const ConversationListSchema = listSchema("ConversationList", ConversationSchema);
export const MessageListSchema = listSchema("MessageList", MessageSchema);
export const ChannelListSchema = listSchema("ChannelList", ChannelSchema);
export const NotificationListSchema = listSchema("NotificationList", NotificationSchema);
export const OperationListSchema = listSchema("OperationList", OperationSchema);
export const AuditRecordListSchema = listSchema("AuditRecordList", AuditRecordSchema);

export const FrameworkCreateInputSchema = Type.Object({ name: Label, endpoint: Type.String({ format: "uri", maxLength: 2_048 }), credentialReference: Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 }) }, { $id: "FrameworkCreateInput", ...strict });
export const FrameworkUpdateInputSchema = Type.Object({ name: Type.Optional(Label), endpoint: Type.Optional(Type.String({ format: "uri", maxLength: 2_048 })), credentialReference: Type.Optional(Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 })), state: Type.Optional(ResourceState) }, { $id: "FrameworkUpdateInput", minProperties: 1, ...strict });
export const ProfileCreateInputSchema = Type.Object({ frameworkId: canonicalIdSchema("framework"), nativeReference: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })), name: Label, description: Type.Optional(Type.String({ maxLength: 5_000 })), protected: Type.Optional(Type.Boolean()) }, { $id: "ProfileCreateInput", ...strict });
export const ProfileUpdateInputSchema = Type.Object({ name: Type.Optional(Label), description: OptionalDescription, state: Type.Optional(ResourceState) }, { $id: "ProfileUpdateInput", minProperties: 1, ...strict });
export const IdentityFileSchema = Type.Object({ path: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$" }), content: Type.String({ maxLength: 1_000_000 }), expectedSha256: Type.Optional(Sha256Schema) }, { $id: "IdentityFile", ...strict });
export const ProfileIdentityInputSchema = Type.Object({ files: Type.Array(IdentityFileSchema, { minItems: 1, maxItems: 100 }), observedVersion: Type.String({ minLength: 1, maxLength: 500 }) }, { $id: "ProfileIdentityInput", ...strict });
export const ProfileModelPolicyInputSchema = Type.Object({ primaryModelId: canonicalIdSchema("model"), fallbackModelIds: Type.Array(canonicalIdSchema("model"), { maxItems: 20, uniqueItems: true }) }, { $id: "ProfileModelPolicyInput", ...strict });
export const RuntimeActionInputSchema = Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")]), reason: Type.String({ minLength: 1, maxLength: 1_000 }) }, { $id: "RuntimeActionInput", ...strict });
export const CredentialReferenceInputSchema = Type.Object({ secretReference: Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 }), rotationReason: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })) }, { $id: "CredentialReferenceInput", ...strict });
export const ProviderValidationInputSchema = Type.Object({ timeoutSeconds: Type.Integer({ minimum: 1, maximum: 60 }) }, { $id: "ProviderValidationInput", ...strict });
export const RoutingPolicyInputSchema = Type.Object({ profileId: canonicalIdSchema("profile"), primaryModelId: canonicalIdSchema("model"), fallbackModelIds: Type.Array(canonicalIdSchema("model"), { maxItems: 20, uniqueItems: true }), requiredCapabilities: StringArray }, { $id: "RoutingPolicyInput", ...strict });
export const ProjectCreateInputSchema = Type.Object({ name: Label, goal: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })), profileIds: Type.Optional(Type.Array(canonicalIdSchema("profile"), { minItems: 1, maxItems: 100, uniqueItems: true })), projectManagerProfileId: Type.Optional(canonicalIdSchema("profile")), activate: Type.Boolean(), scheduledActivationAt: Type.Optional(TimestampSchema), workspaceReference: Type.Optional(Type.String({ maxLength: 2_048 })) }, { $id: "ProjectCreateInput", ...strict });
export const ProjectUpdateInputSchema = Type.Object({ name: Type.Optional(Label), goal: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })), profileIds: Type.Optional(Type.Array(canonicalIdSchema("profile"), { maxItems: 100, uniqueItems: true })), projectManagerProfileId: Type.Optional(Type.Union([canonicalIdSchema("profile"), Type.Null()])), workspaceReference: Type.Optional(Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()])) }, { $id: "ProjectUpdateInput", minProperties: 1, ...strict });
export const LifecycleActionInputSchema = Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("pause"), Type.Literal("resume"), Type.Literal("finish"), Type.Literal("reflect"), Type.Literal("archive"), Type.Literal("restore")]), reason: Type.String({ minLength: 1, maxLength: 1_000 }) }, { $id: "LifecycleActionInput", ...strict });
export const TaskCreateInputSchema = Type.Object({ boardId: canonicalIdSchema("board"), lane: SlugSchema, title: Label, description: Type.Optional(Type.String({ maxLength: 10_000 })), priority: Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("urgent")]), assigneeProfileId: Type.Optional(canonicalIdSchema("profile")) }, { $id: "TaskCreateInput", ...strict });
export const TaskUpdateInputSchema = Type.Object({ title: Type.Optional(Label), description: Type.Optional(Type.String({ maxLength: 10_000 })), priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("urgent")])), assigneeProfileId: Type.Optional(Type.Union([canonicalIdSchema("profile"), Type.Null()])) }, { $id: "TaskUpdateInput", minProperties: 1, ...strict });
export const TaskTransitionInputSchema = Type.Object({ action: Type.Union([Type.Literal("start"), Type.Literal("move"), Type.Literal("block"), Type.Literal("unblock"), Type.Literal("complete"), Type.Literal("archive")]), lane: Type.Optional(SlugSchema), reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })) }, { $id: "TaskTransitionInput", ...strict });
export const TaskCommentInputSchema = Type.Object({ body: NonEmptyTextSchema, evidenceReferences: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 100 })) }, { $id: "TaskCommentInput", ...strict });
export const WorkScheduleInputSchema = Type.Object({ kind: Type.Union([Type.Literal("at"), Type.Literal("every"), Type.Literal("cron")]), expression: Type.String({ minLength: 1, maxLength: 200 }), timezone: Type.String({ minLength: 1, maxLength: 100 }), enabled: Type.Boolean() }, { $id: "WorkScheduleInput", ...strict });
export const RunActionInputSchema = Type.Object({ action: Type.Union([Type.Literal("run-now"), Type.Literal("cancel"), Type.Literal("retry")]), reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })) }, { $id: "RunActionInput", ...strict });
export const ConversationCreateInputSchema = Type.Object({ profileId: canonicalIdSchema("profile"), title: Type.Optional(Label), channelId: Type.Optional(canonicalIdSchema("channel")) }, { $id: "ConversationCreateInput", ...strict });
export const ConversationUpdateInputSchema = Type.Object({ title: Type.Optional(Label), state: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("archived")])) }, { $id: "ConversationUpdateInput", minProperties: 1, ...strict });
export const MessageCreateInputSchema = Type.Object({ blocks: Type.Array(MessageBlockSchema, { minItems: 1, maxItems: 100 }), delivery: Type.Union([Type.Literal("conversation"), Type.Literal("external-channel")]) }, { $id: "MessageCreateInput", ...strict });
export const AttachmentCreateInputSchema = Type.Object({ filename: Type.String({ minLength: 1, maxLength: 255 }), mediaType: Type.String({ pattern: "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$", maxLength: 200 }), sizeBytes: Type.Integer({ minimum: 1, maximum: 52_428_800 }), sha256: Sha256Schema }, { $id: "AttachmentCreateInput", ...strict });
export const ChannelCreateInputSchema = Type.Object({ profileId: canonicalIdSchema("profile"), kind: Type.Union([Type.Literal("telegram"), Type.Literal("whatsapp"), Type.Literal("custom")]), label: Label, secretReference: Type.String({ pattern: "^secret://[A-Za-z0-9/_.:-]+$", maxLength: 500 }), externalIdentity: Type.Optional(Type.String({ maxLength: 500 })), sessionPolicy: Type.Union([Type.Literal("per-external-conversation"), Type.Literal("single-channel-conversation")]) }, { $id: "ChannelCreateInput", ...strict });
export const NotificationStateInputSchema = Type.Object({ state: Type.Union([Type.Literal("read"), Type.Literal("acknowledged")]) }, { $id: "NotificationStateInput", ...strict });
export const NotificationTestInputSchema = Type.Object({ channelId: canonicalIdSchema("channel"), profileId: canonicalIdSchema("profile"), message: Type.String({ minLength: 1, maxLength: 1_000 }) }, { $id: "NotificationTestInput", ...strict });
export const OperationActionInputSchema = Type.Object({ action: Type.Union([Type.Literal("cancel"), Type.Literal("retry")]), reason: Type.String({ minLength: 1, maxLength: 1_000 }) }, { $id: "OperationActionInput", ...strict });
export const AuditVerifyInputSchema = Type.Object({ fromSequence: Type.Integer({ minimum: 1 }), toSequence: Type.Optional(Type.Integer({ minimum: 1 })) }, { $id: "AuditVerifyInput", ...strict });
export const AuditVerificationSchema = Type.Object({ valid: Type.Boolean(), checkedFromSequence: Type.Integer({ minimum: 1 }), checkedToSequence: Type.Integer({ minimum: 1 }), checkedAt: TimestampSchema, firstInvalidRecordId: Type.Union([canonicalIdSchema("audit"), Type.Null()]) }, { $id: "AuditVerification", ...strict });
export const EmptyInputSchema = Type.Object({}, { $id: "EmptyInput", ...strict });

const commandDefinitions = [
  ["FrameworkCreateCommand", "framework.create.v1", FrameworkCreateInputSchema],
  ["FrameworkUpdateCommand", "framework.update.v1", FrameworkUpdateInputSchema],
  ["FrameworkReconcileCommand", "framework.reconcile.v1", EmptyInputSchema],
  ["ProfileCreateCommand", "profile.create.v1", ProfileCreateInputSchema],
  ["ProfileUpdateCommand", "profile.update.v1", ProfileUpdateInputSchema],
  ["ProfileDeleteCommand", "profile.delete.v1", EmptyInputSchema],
  ["ProfileIdentityCommand", "profile.identity.update.v1", ProfileIdentityInputSchema],
  ["ProfileModelPolicyCommand", "profile.model-policy.update.v1", ProfileModelPolicyInputSchema],
  ["ProfileRuntimeActionCommand", "profile.runtime.action.v1", RuntimeActionInputSchema],
  ["ProviderCredentialCommand", "provider.credential-reference.update.v1", CredentialReferenceInputSchema],
  ["ProviderCredentialDeleteCommand", "provider.credential-reference.delete.v1", EmptyInputSchema],
  ["ProviderValidateCommand", "provider.validate.v1", ProviderValidationInputSchema],
  ["RoutingPolicyCommand", "model.routing-policy.update.v1", RoutingPolicyInputSchema],
  ["ProjectCreateCommand", "work.project.create.v1", ProjectCreateInputSchema],
  ["ProjectUpdateCommand", "work.project.update.v1", ProjectUpdateInputSchema],
  ["ProjectLifecycleCommand", "work.project.lifecycle.v1", LifecycleActionInputSchema],
  ["TaskCreateCommand", "work.task.create.v1", TaskCreateInputSchema],
  ["TaskUpdateCommand", "work.task.update.v1", TaskUpdateInputSchema],
  ["TaskTransitionCommand", "work.task.transition.v1", TaskTransitionInputSchema],
  ["TaskCommentCommand", "work.task.comment.v1", TaskCommentInputSchema],
  ["WorkScheduleCommand", "work.schedule.upsert.v1", WorkScheduleInputSchema],
  ["RunActionCommand", "work.run.action.v1", RunActionInputSchema],
  ["ConversationCreateCommand", "conversation.create.v1", ConversationCreateInputSchema],
  ["ConversationUpdateCommand", "conversation.update.v1", ConversationUpdateInputSchema],
  ["ConversationDeleteCommand", "conversation.delete.v1", EmptyInputSchema],
  ["MessageCreateCommand", "conversation.message.create.v1", MessageCreateInputSchema],
  ["AttachmentCreateCommand", "conversation.attachment.create.v1", AttachmentCreateInputSchema],
  ["ChannelCreateCommand", "conversation.channel.create.v1", ChannelCreateInputSchema],
  ["NotificationStateCommand", "notification.state.update.v1", NotificationStateInputSchema],
  ["NotificationTestCommand", "notification.delivery.test.v1", NotificationTestInputSchema],
  ["OperationActionCommand", "operation.action.v1", OperationActionInputSchema],
  ["AuditVerifyCommand", "audit.chain.verify.v1", AuditVerifyInputSchema],
] as const;

export const CommandSchemas = Object.fromEntries(commandDefinitions.map(([name, type, payload]) => [name, commandEnvelopeSchema(name, type, payload)])) as Record<string, TSchema>;

export const ResourceSchemas: Record<string, TSchema> = {
  LoginInput: LoginInputSchema,
  Principal: PrincipalSchema,
  IdentitySession: IdentitySessionSchema,
  IdentitySessionList: IdentitySessionListSchema,
  MfaEnrollmentChallenge: MfaEnrollmentChallengeSchema,
  ServiceCredential: ServiceCredentialSchema,
  ServiceCredentialList: ServiceCredentialListSchema,
  ServiceCredentialIssued: ServiceCredentialIssuedSchema,
  Framework: FrameworkSchema,
  FrameworkList: FrameworkListSchema,
  Profile: ProfileSchema,
  ProfileList: ProfileListSchema,
  Provider: ProviderSchema,
  ProviderList: ProviderListSchema,
  Model: ModelSchema,
  ModelList: ModelListSchema,
  Project: ProjectSchema,
  ProjectList: ProjectListSchema,
  Board: BoardSchema,
  BoardList: BoardListSchema,
  Task: TaskSchema,
  TaskList: TaskListSchema,
  TaskComment: TaskCommentSchema,
  TaskCommentList: TaskCommentListSchema,
  WorkSchedule: WorkScheduleSchema,
  WorkScheduleList: WorkScheduleListSchema,
  WorkRun: WorkRunSchema,
  WorkRunList: WorkRunListSchema,
  ConversationAgent: ConversationAgentSchema,
  ConversationAgentList: ConversationAgentListSchema,
  Conversation: ConversationSchema,
  ConversationList: ConversationListSchema,
  Message: MessageSchema,
  MessageList: MessageListSchema,
  Attachment: AttachmentSchema,
  Channel: ChannelSchema,
  ChannelList: ChannelListSchema,
  Notification: NotificationSchema,
  NotificationList: NotificationListSchema,
  Operation: OperationSchema,
  OperationList: OperationListSchema,
  AuditRecord: AuditRecordSchema,
  AuditRecordList: AuditRecordListSchema,
  AuditVerification: AuditVerificationSchema,
};

export const InputSchemas: Record<string, TSchema> = {
  PasswordChangeInput: PasswordChangeInputSchema,
  MfaEnrollmentStartInput: MfaEnrollmentStartInputSchema,
  MfaEnrollmentConfirmInput: MfaEnrollmentConfirmInputSchema,
  MfaRemovalInput: MfaRemovalInputSchema,
  ServiceCredentialCreateInput: ServiceCredentialCreateInputSchema,
  FrameworkCreateInput: FrameworkCreateInputSchema,
  FrameworkUpdateInput: FrameworkUpdateInputSchema,
  ProfileCreateInput: ProfileCreateInputSchema,
  ProfileUpdateInput: ProfileUpdateInputSchema,
  ProfileIdentityInput: ProfileIdentityInputSchema,
  ProfileModelPolicyInput: ProfileModelPolicyInputSchema,
  RuntimeActionInput: RuntimeActionInputSchema,
  CredentialReferenceInput: CredentialReferenceInputSchema,
  ProviderValidationInput: ProviderValidationInputSchema,
  RoutingPolicyInput: RoutingPolicyInputSchema,
  ProjectCreateInput: ProjectCreateInputSchema,
  ProjectUpdateInput: ProjectUpdateInputSchema,
  LifecycleActionInput: LifecycleActionInputSchema,
  TaskCreateInput: TaskCreateInputSchema,
  TaskUpdateInput: TaskUpdateInputSchema,
  TaskTransitionInput: TaskTransitionInputSchema,
  TaskCommentInput: TaskCommentInputSchema,
  WorkScheduleInput: WorkScheduleInputSchema,
  RunActionInput: RunActionInputSchema,
  ConversationCreateInput: ConversationCreateInputSchema,
  ConversationUpdateInput: ConversationUpdateInputSchema,
  MessageCreateInput: MessageCreateInputSchema,
  AttachmentCreateInput: AttachmentCreateInputSchema,
  ChannelCreateInput: ChannelCreateInputSchema,
  NotificationStateInput: NotificationStateInputSchema,
  NotificationTestInput: NotificationTestInputSchema,
  OperationActionInput: OperationActionInputSchema,
  AuditVerifyInput: AuditVerifyInputSchema,
  EmptyInput: EmptyInputSchema,
};

export const PrimitiveSchemas: Record<string, TSchema> = {
  ContractVersion: ContractVersionSchema,
  CanonicalId: CanonicalIdSchema,
  Timestamp: TimestampSchema,
  ResourceVersion: ResourceVersionSchema,
  Cursor: CursorSchema,
  Sha256: Sha256Schema,
  ResourceMeta: ResourceMetaSchema,
  PageMeta: PageMetaSchema,
};
