export function deploymentImages(
  env: Record<string, string | undefined>,
  required: (name: string) => string,
): Record<string, string> {
  if (env.HERMES_DEPLOYED_IMAGES_JSON !== undefined) {
    const value: unknown = JSON.parse(env.HERMES_DEPLOYED_IMAGES_JSON);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length === 0 ||
        Object.entries(value).some(([id, image]) =>
          !/^[a-z][a-z0-9-]{1,127}$/.test(id) || typeof image !== 'string' ||
          !/^\S+@sha256:[a-f0-9]{64}$/.test(image))) {
      throw new Error('HERMES_DEPLOYED_IMAGES_JSON must map framework IDs to digest-pinned images');
    }
    return value as Record<string, string>;
  }
  return {
    'hermes-alica': env.ALICA_HERMES_RUNTIME_IMAGE ?? required('HERMES_RUNTIME_IMAGE'),
    'hermes-herman': env.HERMAN_HERMES_RUNTIME_IMAGE ?? required('HERMES_RUNTIME_IMAGE'),
  };
}
