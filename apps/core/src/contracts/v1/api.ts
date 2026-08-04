import type { TSchema } from "@sinclair/typebox";
import { CapabilitySchemas } from "./capabilities.js";
import { ActorSchema, ApiErrorSchema, CommandAcceptedSchema, CommandTargetSchema, ErrorResponseSchema, EventEnvelopeSchema, FieldViolationSchema } from "./envelopes.js";
import { CanonicalIdSchema, ContractVersionSchema, CursorSchema, IdempotencyKeySchema, PageMetaSchema, ResourceMetaSchema, ResourceVersionSchema, Sha256Schema, TimestampSchema, canonicalIdPattern } from "./primitives.js";
import { CommandSchemas, InputSchemas, PrimitiveSchemas, ResourceSchemas } from "./schemas.js";

export const CORE_API_DOMAINS = [
  "identity",
  "frameworks",
  "profiles",
  "models",
  "work",
  "conversations",
  "notifications",
  "operations",
  "audit",
] as const;

export type CoreApiDomain = (typeof CORE_API_DOMAINS)[number];
type HttpMethod = "get" | "post" | "patch" | "put" | "delete";
type Security = "public" | "authenticated" | "userMutation" | "mutation" | "service";

export interface ApiEndpoint {
  readonly domain: CoreApiDomain;
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly security: Security;
  readonly requestSchema?: string;
  readonly successSchema?: string;
  readonly successStatus: 200 | 201 | 202 | 204;
}

export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  { domain: "identity", method: "post", path: "/identity/login", operationId: "identityLogin", summary: "Authenticate a user", security: "public", requestSchema: "LoginInput", successSchema: "Principal", successStatus: 200 },
  { domain: "identity", method: "post", path: "/identity/logout", operationId: "identityLogout", summary: "End the current identity session", security: "userMutation", successStatus: 204 },
  { domain: "identity", method: "get", path: "/identity/principal", operationId: "identityGetPrincipal", summary: "Get the current principal", security: "authenticated", successSchema: "Principal", successStatus: 200 },
  { domain: "identity", method: "get", path: "/identity/sessions", operationId: "identityListSessions", summary: "List identity sessions", security: "authenticated", successSchema: "IdentitySessionList", successStatus: 200 },
  { domain: "identity", method: "delete", path: "/identity/sessions/{sessionId}", operationId: "identityRevokeSession", summary: "Revoke an identity session", security: "userMutation", successStatus: 204 },
  { domain: "identity", method: "post", path: "/identity/password-changes", operationId: "identityChangePassword", summary: "Change the current user password", security: "userMutation", requestSchema: "PasswordChangeInput", successStatus: 204 },
  { domain: "identity", method: "post", path: "/identity/mfa-enrollments", operationId: "identityStartMfaEnrollment", summary: "Start MFA enrollment", security: "userMutation", requestSchema: "MfaEnrollmentStartInput", successSchema: "MfaEnrollmentChallenge", successStatus: 201 },
  { domain: "identity", method: "post", path: "/identity/mfa-enrollments/{mfaEnrollmentId}/confirmations", operationId: "identityConfirmMfaEnrollment", summary: "Confirm MFA enrollment", security: "userMutation", requestSchema: "MfaEnrollmentConfirmInput", successStatus: 204 },
  { domain: "identity", method: "post", path: "/identity/mfa-removals", operationId: "identityRemoveMfa", summary: "Remove MFA from the current user", security: "userMutation", requestSchema: "MfaRemovalInput", successStatus: 204 },
  { domain: "identity", method: "get", path: "/identity/service-credentials", operationId: "identityListServiceCredentials", summary: "List service credential metadata", security: "authenticated", successSchema: "ServiceCredentialList", successStatus: 200 },
  { domain: "identity", method: "post", path: "/identity/service-credentials", operationId: "identityCreateServiceCredential", summary: "Issue a service credential once", security: "userMutation", requestSchema: "ServiceCredentialCreateInput", successSchema: "ServiceCredentialIssued", successStatus: 201 },
  { domain: "identity", method: "delete", path: "/identity/service-credentials/{credentialId}", operationId: "identityRevokeServiceCredential", summary: "Revoke a service credential", security: "userMutation", successStatus: 204 },

  { domain: "frameworks", method: "get", path: "/frameworks", operationId: "frameworkList", summary: "List registered frameworks", security: "authenticated", successSchema: "FrameworkList", successStatus: 200 },
  { domain: "frameworks", method: "post", path: "/frameworks", operationId: "frameworkCreate", summary: "Register a framework", security: "mutation", requestSchema: "FrameworkCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "frameworks", method: "get", path: "/frameworks/{frameworkId}", operationId: "frameworkGet", summary: "Get a framework", security: "authenticated", successSchema: "Framework", successStatus: 200 },
  { domain: "frameworks", method: "patch", path: "/frameworks/{frameworkId}", operationId: "frameworkUpdate", summary: "Update a framework registration", security: "mutation", requestSchema: "FrameworkUpdateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "frameworks", method: "get", path: "/frameworks/{frameworkId}/health", operationId: "frameworkGetHealth", summary: "Get observed framework health", security: "authenticated", successSchema: "Operation", successStatus: 200 },
  { domain: "frameworks", method: "get", path: "/frameworks/{frameworkId}/capabilities", operationId: "frameworkGetCapabilities", summary: "Get the current Hermes capability document", security: "authenticated", successSchema: "HermesCapabilityDocument", successStatus: 200 },
  { domain: "frameworks", method: "post", path: "/frameworks/{frameworkId}/capability-negotiations", operationId: "frameworkNegotiateCapabilities", summary: "Negotiate effective Hermes capabilities", security: "service", requestSchema: "CapabilityNegotiationRequest", successSchema: "CapabilityNegotiationResult", successStatus: 200 },
  { domain: "frameworks", method: "post", path: "/frameworks/{frameworkId}/reconciliations", operationId: "frameworkReconcile", summary: "Reconcile framework desired and observed state", security: "mutation", requestSchema: "FrameworkReconcileCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "profiles", method: "get", path: "/profiles", operationId: "profileList", summary: "List profiles", security: "authenticated", successSchema: "ProfileList", successStatus: 200 },
  { domain: "profiles", method: "post", path: "/profiles", operationId: "profileCreate", summary: "Create a profile", security: "mutation", requestSchema: "ProfileCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "profiles", method: "get", path: "/profiles/{profileId}", operationId: "profileGet", summary: "Get a profile", security: "authenticated", successSchema: "Profile", successStatus: 200 },
  { domain: "profiles", method: "patch", path: "/profiles/{profileId}", operationId: "profileUpdate", summary: "Update a profile", security: "mutation", requestSchema: "ProfileUpdateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "profiles", method: "delete", path: "/profiles/{profileId}", operationId: "profileDelete", summary: "Delete or archive a profile", security: "mutation", requestSchema: "ProfileDeleteCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "profiles", method: "put", path: "/profiles/{profileId}/identity", operationId: "profileUpdateIdentity", summary: "Update profile identity files", security: "mutation", requestSchema: "ProfileIdentityCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "profiles", method: "put", path: "/profiles/{profileId}/model-policy", operationId: "profileUpdateModelPolicy", summary: "Update a profile model policy", security: "mutation", requestSchema: "ProfileModelPolicyCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "profiles", method: "post", path: "/profiles/{profileId}/runtime-actions", operationId: "profileRuntimeAction", summary: "Execute a profile runtime action", security: "mutation", requestSchema: "ProfileRuntimeActionCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "models", method: "get", path: "/providers", operationId: "providerList", summary: "List providers", security: "authenticated", successSchema: "ProviderList", successStatus: 200 },
  { domain: "models", method: "put", path: "/providers/{providerId}/credential-reference", operationId: "providerUpdateCredentialReference", summary: "Update a provider credential reference", security: "mutation", requestSchema: "ProviderCredentialCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "models", method: "delete", path: "/providers/{providerId}/credential-reference", operationId: "providerDeleteCredentialReference", summary: "Delete a provider credential reference", security: "mutation", requestSchema: "ProviderCredentialDeleteCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "models", method: "post", path: "/providers/{providerId}/validations", operationId: "providerValidate", summary: "Validate a provider configuration", security: "mutation", requestSchema: "ProviderValidateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "models", method: "get", path: "/models", operationId: "modelList", summary: "List models", security: "authenticated", successSchema: "ModelList", successStatus: 200 },
  { domain: "models", method: "put", path: "/model-routing-policies/{profileId}", operationId: "modelUpdateRoutingPolicy", summary: "Update model routing policy", security: "mutation", requestSchema: "RoutingPolicyCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "work", method: "get", path: "/work/projects", operationId: "workProjectList", summary: "List projects", security: "authenticated", successSchema: "ProjectList", successStatus: 200 },
  { domain: "work", method: "post", path: "/work/projects", operationId: "workProjectCreate", summary: "Create or activate a project", security: "mutation", requestSchema: "ProjectCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/projects/{projectId}", operationId: "workProjectGet", summary: "Get a project", security: "authenticated", successSchema: "Project", successStatus: 200 },
  { domain: "work", method: "patch", path: "/work/projects/{projectId}", operationId: "workProjectUpdate", summary: "Update a project", security: "mutation", requestSchema: "ProjectUpdateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "post", path: "/work/projects/{projectId}/lifecycle-actions", operationId: "workProjectLifecycleAction", summary: "Apply a project lifecycle action", security: "mutation", requestSchema: "ProjectLifecycleCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/projects/{projectId}/boards", operationId: "workBoardList", summary: "List project boards", security: "authenticated", successSchema: "BoardList", successStatus: 200 },
  { domain: "work", method: "get", path: "/work/boards/{boardId}", operationId: "workBoardGet", summary: "Get a board", security: "authenticated", successSchema: "Board", successStatus: 200 },
  { domain: "work", method: "get", path: "/work/tasks", operationId: "workTaskList", summary: "List tasks", security: "authenticated", successSchema: "TaskList", successStatus: 200 },
  { domain: "work", method: "post", path: "/work/tasks", operationId: "workTaskCreate", summary: "Create a task", security: "mutation", requestSchema: "TaskCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/tasks/{taskId}", operationId: "workTaskGet", summary: "Get a task", security: "authenticated", successSchema: "Task", successStatus: 200 },
  { domain: "work", method: "patch", path: "/work/tasks/{taskId}", operationId: "workTaskUpdate", summary: "Update a task", security: "mutation", requestSchema: "TaskUpdateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "post", path: "/work/tasks/{taskId}/transitions", operationId: "workTaskTransition", summary: "Apply a task transition", security: "mutation", requestSchema: "TaskTransitionCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/tasks/{taskId}/comments", operationId: "workTaskCommentList", summary: "List task comments", security: "authenticated", successSchema: "TaskCommentList", successStatus: 200 },
  { domain: "work", method: "post", path: "/work/tasks/{taskId}/comments", operationId: "workTaskCommentCreate", summary: "Add a task comment", security: "mutation", requestSchema: "TaskCommentCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/projects/{projectId}/schedules", operationId: "workScheduleList", summary: "List project schedules", security: "authenticated", successSchema: "WorkScheduleList", successStatus: 200 },
  { domain: "work", method: "put", path: "/work/projects/{projectId}/schedules/{scheduleId}", operationId: "workScheduleUpsert", summary: "Create or update a project schedule", security: "mutation", requestSchema: "WorkScheduleCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "work", method: "get", path: "/work/runs", operationId: "workRunList", summary: "List work runs", security: "authenticated", successSchema: "WorkRunList", successStatus: 200 },
  { domain: "work", method: "post", path: "/work/runs/{runId}/actions", operationId: "workRunAction", summary: "Apply a work run action", security: "mutation", requestSchema: "RunActionCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "conversations", method: "get", path: "/conversation-agents", operationId: "conversationAgentList", summary: "List conversation agents", security: "authenticated", successSchema: "ConversationAgentList", successStatus: 200 },
  { domain: "conversations", method: "get", path: "/conversations", operationId: "conversationList", summary: "List conversations", security: "authenticated", successSchema: "ConversationList", successStatus: 200 },
  { domain: "conversations", method: "post", path: "/conversations", operationId: "conversationCreate", summary: "Create a conversation", security: "mutation", requestSchema: "ConversationCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "get", path: "/conversations/{conversationId}", operationId: "conversationGet", summary: "Get a conversation", security: "authenticated", successSchema: "Conversation", successStatus: 200 },
  { domain: "conversations", method: "patch", path: "/conversations/{conversationId}", operationId: "conversationUpdate", summary: "Update a conversation", security: "mutation", requestSchema: "ConversationUpdateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "delete", path: "/conversations/{conversationId}", operationId: "conversationDelete", summary: "Delete or archive a conversation according to ownership", security: "mutation", requestSchema: "ConversationDeleteCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "get", path: "/conversations/{conversationId}/messages", operationId: "messageList", summary: "List conversation messages", security: "authenticated", successSchema: "MessageList", successStatus: 200 },
  { domain: "conversations", method: "post", path: "/conversations/{conversationId}/messages", operationId: "messageCreate", summary: "Send a conversation message", security: "mutation", requestSchema: "MessageCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "post", path: "/attachments", operationId: "attachmentCreate", summary: "Create an attachment upload", security: "mutation", requestSchema: "AttachmentCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "get", path: "/channels", operationId: "channelList", summary: "List conversation channels", security: "authenticated", successSchema: "ChannelList", successStatus: 200 },
  { domain: "conversations", method: "post", path: "/channels", operationId: "channelCreate", summary: "Create a conversation channel", security: "mutation", requestSchema: "ChannelCreateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "conversations", method: "get", path: "/events", operationId: "eventStream", summary: "Resume the authorized event stream", security: "authenticated", successSchema: "EventEnvelope", successStatus: 200 },

  { domain: "notifications", method: "get", path: "/notifications", operationId: "notificationList", summary: "List notifications", security: "authenticated", successSchema: "NotificationList", successStatus: 200 },
  { domain: "notifications", method: "post", path: "/notifications/{notificationId}/state", operationId: "notificationUpdateState", summary: "Update notification state", security: "mutation", requestSchema: "NotificationStateCommand", successSchema: "CommandAccepted", successStatus: 202 },
  { domain: "notifications", method: "post", path: "/notification-delivery-tests", operationId: "notificationTestDelivery", summary: "Test notification delivery", security: "mutation", requestSchema: "NotificationTestCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "operations", method: "get", path: "/operations", operationId: "operationList", summary: "List operations", security: "authenticated", successSchema: "OperationList", successStatus: 200 },
  { domain: "operations", method: "get", path: "/operations/{operationId}", operationId: "operationGet", summary: "Get an operation", security: "authenticated", successSchema: "Operation", successStatus: 200 },
  { domain: "operations", method: "post", path: "/operations/{operationId}/actions", operationId: "operationAction", summary: "Cancel or retry an operation", security: "mutation", requestSchema: "OperationActionCommand", successSchema: "CommandAccepted", successStatus: 202 },

  { domain: "audit", method: "get", path: "/audit/records", operationId: "auditRecordList", summary: "List audit records", security: "authenticated", successSchema: "AuditRecordList", successStatus: 200 },
  { domain: "audit", method: "get", path: "/audit/records/{auditId}", operationId: "auditRecordGet", summary: "Get an audit record", security: "authenticated", successSchema: "AuditRecord", successStatus: 200 },
  { domain: "audit", method: "post", path: "/audit/verifications", operationId: "auditVerifyChain", summary: "Verify an audit hash chain", security: "mutation", requestSchema: "AuditVerifyCommand", successSchema: "CommandAccepted", successStatus: 202 },
];

const componentSchemas: Record<string, TSchema> = {
  ...PrimitiveSchemas,
  Actor: ActorSchema,
  CommandTarget: CommandTargetSchema,
  ApiError: ApiErrorSchema,
  FieldViolation: FieldViolationSchema,
  ErrorResponse: ErrorResponseSchema,
  CommandAccepted: CommandAcceptedSchema,
  EventEnvelope: EventEnvelopeSchema,
  ...InputSchemas,
  ...ResourceSchemas,
  ...CommandSchemas,
  ...CapabilitySchemas,
};

function jsonContent(schemaName: string): Record<string, unknown> {
  return { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } };
}

function response(description: string, schemaName?: string): Record<string, unknown> {
  return schemaName ? { description, content: jsonContent(schemaName) } : { description };
}

function securityFor(security: Security): readonly Record<string, readonly string[]>[] {
  if (security === "public") return [];
  if (security === "service") return [{ serviceBearer: [] }];
  if (security === "userMutation") return [{ cookieSession: [], csrfToken: [] }];
  if (security === "mutation") return [{ cookieSession: [], csrfToken: [] }, { serviceBearer: [] }];
  return [{ cookieSession: [] }, { serviceBearer: [] }];
}

const pathParameterKinds = {
  sessionId: "session",
  mfaEnrollmentId: "mfaEnrollment",
  credentialId: "credential",
  frameworkId: "framework",
  profileId: "profile",
  providerId: "provider",
  projectId: "project",
  boardId: "board",
  taskId: "task",
  scheduleId: "schedule",
  runId: "run",
  conversationId: "conversation",
  notificationId: "notification",
  operationId: "operation",
  auditId: "audit",
} as const;

function parametersFor(endpoint: ApiEndpoint): readonly Record<string, unknown>[] {
  const parameters: Record<string, unknown>[] = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => {
    const name = match[1]!;
    const kind = pathParameterKinds[name as keyof typeof pathParameterKinds];
    if (!kind) throw new Error(`No canonical ID kind declared for path parameter ${name}`);
    return {
      name,
      in: "path",
      required: true,
      schema: { type: "string", pattern: canonicalIdPattern(kind) },
    };
  });

  if (endpoint.operationId.endsWith("List")) {
    parameters.push(
      { name: "cursor", in: "query", required: false, schema: { $ref: "#/components/schemas/Cursor" } },
      { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    );
  }
  if (endpoint.operationId === "eventStream") {
    parameters.push({ name: "cursor", in: "query", required: false, schema: { $ref: "#/components/schemas/Cursor" } });
  }
  return parameters;
}

export function buildCoreV1OpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_ENDPOINTS) {
    const pathItem = paths[endpoint.path] ?? {};
    const success = response(endpoint.successStatus === 204 ? "Completed" : "Success", endpoint.successSchema);
    pathItem[endpoint.method] = {
      tags: [endpoint.domain],
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      security: securityFor(endpoint.security),
      parameters: parametersFor(endpoint),
      "x-unify-reject-unknown-query": true,
      ...(endpoint.requestSchema ? { requestBody: { required: true, content: jsonContent(endpoint.requestSchema) } } : {}),
      responses: {
        [String(endpoint.successStatus)]: success,
        "400": response("Invalid request", "ErrorResponse"),
        "401": response("Authentication required", "ErrorResponse"),
        "403": response("Authorization denied", "ErrorResponse"),
        "404": response("Resource not found", "ErrorResponse"),
        "409": response("Resource or idempotency conflict", "ErrorResponse"),
        "422": response("Command precondition failed", "ErrorResponse"),
        "429": response("Rate limited", "ErrorResponse"),
        "503": response("Temporarily unavailable", "ErrorResponse"),
      },
    };
    paths[endpoint.path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "UNIFY Core API",
      version: "1.0.0",
      description: "Native standalone UNIFY control-plane contract.",
    },
    servers: [{ url: "/core/v1" }],
    tags: CORE_API_DOMAINS.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        cookieSession: { type: "apiKey", in: "cookie", name: "unify_session" },
        csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        serviceBearer: { type: "http", scheme: "bearer", bearerFormat: "opaque-service-credential" },
      },
      schemas: componentSchemas,
    },
  };
}

export function getCoreV1SchemaCatalog(): Readonly<Record<string, TSchema>> {
  return componentSchemas;
}

export { CanonicalIdSchema, ContractVersionSchema, CursorSchema, IdempotencyKeySchema, PageMetaSchema, ResourceMetaSchema, ResourceVersionSchema, Sha256Schema, TimestampSchema };
