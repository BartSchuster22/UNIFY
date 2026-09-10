import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AuthError } from '../auth/service.js';
export const APPLICATION_CONTRACT = 'alica-application/v1' as const;
const Id = Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' });
export const ManifestSchema = Type.Object(
  {
    contractVersion: Type.Literal(APPLICATION_CONTRACT),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    frameworkId: Id,
    projectId: Id,
    subjects: Type.Array(Id, { minItems: 1, maxItems: 1000, uniqueItems: true }),
    operations: Type.Array(
      Type.Union(['answer', 'research', 'refresh', 'correction'].map((x) => Type.Literal(x))),
      { minItems: 1, maxItems: 4, uniqueItems: true },
    ),
    sourceUrls: Type.Array(Type.String({ minLength: 10, maxLength: 2048 }), {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
    }),
    callbackUrl: Type.Optional(Type.String({ maxLength: 2048 })),
    retentionDays: Type.Integer({ minimum: 1, maximum: 30 }),
    promotionPolicy: Type.Literal('verified-extract-v1'),
  },
  { additionalProperties: false },
);
export type ApplicationManifest = Static<typeof ManifestSchema>;
export const RequestSchema = Type.Object(
  {
    contractVersion: Type.Literal(APPLICATION_CONTRACT),
    subject: Id,
    operation: Type.Union(
      ['answer', 'research', 'refresh', 'correction'].map((x) => Type.Literal(x)),
    ),
    question: Type.String({ minLength: 1, maxLength: 4000 }),
    corrects: Type.Optional(
      Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' }),
    ),
  },
  { additionalProperties: false },
);
export type ApplicationRequest = Static<typeof RequestSchema>;
export function parseManifest(value: unknown): ApplicationManifest {
  if (!Value.Check(ManifestSchema, value))
    throw new AuthError(
      'APPLICATION_MANIFEST_INVALID',
      422,
      'Manifest is outside alica-application/v1',
    );
  for (const s of [...value.sourceUrls, ...(value.callbackUrl ? [value.callbackUrl] : [])]) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new AuthError('APPLICATION_URL_INVALID', 422, 'Invalid destination');
    }
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== '443')
    )
      throw new AuthError(
        'APPLICATION_URL_INVALID',
        422,
        'Only HTTPS port 443 destinations without userinfo or fragments are permitted',
      );
  }
  return value;
}
export function parseRequest(value: unknown, manifest: ApplicationManifest): ApplicationRequest {
  if (!Value.Check(RequestSchema, value))
    throw new AuthError(
      'APPLICATION_PAYLOAD_INVALID',
      422,
      'Request is outside alica-application/v1',
    );
  if (!manifest.subjects.includes(value.subject) || !manifest.operations.includes(value.operation))
    throw new AuthError('APPLICATION_GRANT_DENIED', 403, 'Subject or operation not granted');
  if ((value.operation === 'correction') !== Boolean(value.corrects))
    throw new AuthError(
      'APPLICATION_CORRECTION_INVALID',
      422,
      'Only correction requires a previous receipt',
    );
  return value;
}
