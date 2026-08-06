import { Value } from '@sinclair/typebox/value';
import { Type, type Static } from '@sinclair/typebox';
import { FrameworkRegistrationInputSchema } from '@aquiero/contracts';

export const DeclarativeFrameworkRegistrationsSchema = Type.Object(
  {
    schemaVersion: Type.Literal('unify-framework-registrations/v1'),
    frameworks: Type.Array(FrameworkRegistrationInputSchema, { minItems: 1, maxItems: 32 }),
  },
  { additionalProperties: false },
);

export type DeclarativeFrameworkRegistrations = Static<
  typeof DeclarativeFrameworkRegistrationsSchema
>;

export function parseDeclarativeFrameworkRegistrations(
  value: unknown,
): DeclarativeFrameworkRegistrations {
  if (!Value.Check(DeclarativeFrameworkRegistrationsSchema, value)) {
    const errors = [...Value.Errors(DeclarativeFrameworkRegistrationsSchema, value)]
      .slice(0, 5)
      .map((error) => `${error.path || '/'} ${error.message}`)
      .join('; ');
    throw new Error(`Invalid framework registration declaration: ${errors}`);
  }
  const ids = new Set<string>();
  const authReferences = new Set<string>();
  for (const framework of value.frameworks) {
    if (ids.has(framework.frameworkId))
      throw new Error(`Duplicate framework ID: ${framework.frameworkId}`);
    if (authReferences.has(framework.serviceAuthReference))
      throw new Error('Each framework must use a distinct service authentication reference');
    ids.add(framework.frameworkId);
    authReferences.add(framework.serviceAuthReference);
  }
  return structuredClone(value);
}
