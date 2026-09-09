/** Validate offline CLI release and the upstream image's immutable source marker.
 * Artifact digest and source-tree checks remain the installer's prerequisite.
 */
export function verifyPackagedBaseline(version: string, marker: string, release: string, commit: string) {
  const actualRelease = /Hermes Agent v([^\s]+)/u.exec(version)?.[1];
  if (!/^[a-f0-9]{40}$/u.test(commit) || marker.trim() !== commit || actualRelease !== release)
    throw new Error('Installed Hermes release does not match the immutable supported baseline');
}
