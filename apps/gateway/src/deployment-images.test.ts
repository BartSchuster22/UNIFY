import { describe, it, expect } from 'vitest';
import { deploymentImages } from './deployment-images.js';
const image = 'example/hermes@sha256:' + 'a'.repeat(64);
const required = () => image;
describe('declared deployment inventory', () => {
  it('represents exactly one declared framework', () => {
    expect(
      deploymentImages(
        { HERMES_DEPLOYED_IMAGES_JSON: JSON.stringify({ 'hermes-alica': image }) },
        required,
      ),
    ).toEqual({ 'hermes-alica': image });
  });
  it.each(['{}', '[]', 'null', '{"hermes-alica":"example:latest"}'])(
    'rejects invalid explicit metadata %s',
    (value) => {
      expect(() => deploymentImages({ HERMES_DEPLOYED_IMAGES_JSON: value }, required)).toThrow();
    },
  );
  it('preserves the legacy default only when no explicit inventory exists', () => {
    expect(Object.keys(deploymentImages({}, required))).toEqual(['hermes-alica', 'hermes-herman']);
  });
});
