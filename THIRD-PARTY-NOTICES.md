# ALICA Community DSH — Third-Party Notice Policy

ALICA Community DSH combines proprietary ALICA Ltd components with third-party software. The ALICA EULA applies only to ALICA Ltd first-party material and does not replace or restrict third-party license rights.

## D0 known direct components

| Component                                     | Owner/upstream                                         | D0 license classification                                                  | Distribution rule                                                                             |
| --------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hermes Agent runtime used by Alica/Herman     | Nous Research                                          | MIT                                                                        | Include the MIT copyright and permission notice in the exact release                          |
| Keycloak                                      | Keycloak project/Red Hat contributors                  | Apache-2.0                                                                 | Include license/notice and preserve required attributions                                     |
| PostgreSQL                                    | PostgreSQL Global Development Group                    | PostgreSQL License                                                         | Include license text                                                                          |
| Caddy                                         | Caddy authors                                          | Apache-2.0                                                                 | Include license/notice and account for bundled plugins                                        |
| Docker Engine/Compose client runtime          | Docker/Moby/Compose contributors; installed separately | Open-source component licenses; Docker service/brand terms remain separate | Do not redistribute Docker unless separately approved; verify supported customer installation |
| Node.js and base images                       | respective upstreams                                   | Multiple permissive/open-source licenses                                   | Include exact image and package notices generated from release artifacts                      |
| JavaScript/Python/Go/Rust transitive packages | respective upstreams                                   | Multiple                                                                   | Generate and review complete SBOM/license inventory for exact candidate                       |

## First-party classification

The following are proprietary ALICA Ltd components unless an exact file states otherwise:

- UNIFY Gateway/Core and first-party adapters;
- UNIUI and first-party web applications/components;
- ALICA-specific Hermes integration, configuration, governance and images, excluding upstream Hermes Agent MIT material;
- MemoryV4 first-party implementation;
- AInbA first-party implementation and anchor workload;
- Doghouse first-party implementation;
- `alicactl`, DSH manifests, installer/lifecycle implementation and release service material.

## Release gate

D0 establishes policy and records known direct licenses; it is not a complete release notice. D5 must, for each exact candidate:

1. generate source and OCI-image SBOMs;
2. inventory all licenses and copyright notices;
3. resolve unknown, custom, copyleft and source-offer obligations;
4. bundle every required license/notice/source offer;
5. block forbidden or unresolved dependencies;
6. bind the notice inventory and SBOM digests into the signed release manifest.

A DSH release cannot be published while any shipped component has an unknown or incompatible license.
