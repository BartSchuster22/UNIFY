import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/**
 * Executable red baseline for the UNIFY Functionality QA10 programme.
 *
 * `it.fails` is intentional for Step 1: each test executes and must demonstrate
 * the known production gap. When a later step implements the requirement, that
 * test will become an unexpected pass and Vitest will fail until the marker is
 * removed and the requirement is accepted as a normal regression test.
 */
describe('Functionality QA10 known-gap baseline', () => {
  it.fails('does not hard-code the retired hermes-main framework in production UI routes', () => {
    const routedSources = [source('./api.ts'), source('./ChatView.tsx'), source('./WorkView.tsx')];
    for (const content of routedSources) expect(content).not.toContain('hermes-main');
  });

  it.fails('represents the framework base agents as Alica and Herman instead of Default', () => {
    const adapterSource = source('../../hermes-control-adapter/src/source.ts');
    expect(adapterSource).toContain("case 'profile.rename'");
    expect(adapterSource).not.toContain("id === 'default' ? 'Default' : id");
  });

  it.fails(
    'requires an explicit selected framework for isolated Work and Chat reads and writes',
    () => {
      const workSource = source('./WorkView.tsx');
      const chatSource = source('./ChatView.tsx');
      expect(workSource).toMatch(/WorkView\s*\(\s*\{[^}]*frameworkId/);
      expect(chatSource).toMatch(/ChatView\s*\(\s*\{[^}]*frameworkId/);
      expect(workSource).not.toMatch(/frameworkId:\s*['"]hermes-main['"]/);
      expect(chatSource).not.toMatch(/FRAMEWORK_ID\s*=\s*['"]hermes-main['"]/);
    },
  );

  it.fails('renders an explicit incomplete state when no provider and model are selected', () => {
    const modelsSource = source('./ModelsView.tsx');
    expect(modelsSource).toContain('Configuration incomplete');
    expect(modelsSource).toMatch(/provider[^\n]{0,80}not selected/i);
    expect(modelsSource).toMatch(/model[^\n]{0,80}not selected/i);
  });
});
