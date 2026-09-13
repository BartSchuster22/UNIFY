# Frozen candidate: individual metadata decisions

Steps 1–2 only. No commercial approval or closure of other obligations.

| Image | Scanner record | Classification | Licence metadata |
|---|---|---|---|
| caddy | caddy v0.0.0-20250822212934-551f793700fe | distribution-main-build-record | Apache-2.0 |
| caddy | github.com/antlr4-go/antlr/v4 v4.13.0 | third-party | BSD-3-Clause |
| caddy | github.com/caddyserver/certmagic v0.24.0 | third-party | Apache-2.0 |
| caddy | github.com/cloudflare/circl v1.6.1 | third-party | BSD-3-Clause |
| caddy | github.com/coreos/go-oidc/v3 v3.14.1 | third-party | Apache-2.0 |
| caddy | github.com/dustin/go-humanize v1.0.1 | third-party | MIT |
| caddy | github.com/go-logr/logr v1.4.3 | third-party | Apache-2.0 |
| caddy | github.com/google/cel-go v0.26.0 | third-party | Apache-2.0 AND BSD-3-Clause |
| caddy | github.com/google/go-tspi v0.3.0 | third-party | Apache-2.0 |
| caddy | github.com/grpc-ecosystem/grpc-gateway/v2 v2.27.1 | third-party | BSD-3-Clause |
| caddy | github.com/klauspost/compress v1.18.0 | third-party | BSD-3-Clause AND Apache-2.0 AND MIT |
| caddy | github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 | third-party | BSD-3-Clause |
| caddy | github.com/pires/go-proxyproto v0.8.1 | third-party | Apache-2.0 |
| caddy | github.com/russross/blackfriday/v2 v2.1.0 | third-party | BSD-2-Clause |
| caddy | github.com/shopspring/decimal v1.4.0 | third-party | MIT |
| caddy | github.com/zeebo/blake3 v0.2.4 | third-party | CC0-1.0 |
| caddy | gopkg.in/yaml.v3 v3.0.1 | third-party | MIT AND Apache-2.0 |
| hermes | @aquiero/contracts 0.1.0 | first-party-restricted | LicenseRef-UNIFY-FirstParty-Proprietary |
| hermes | @aquiero/hermes-control-adapter 0.1.0 | first-party-restricted | LicenseRef-UNIFY-FirstParty-Proprietary |
| hermes | github.com/docker/cli/cmd/docker UNKNOWN | owned-binary-subrecord | LicenseRef-Debian-DockerCLI-26.1.5-Distribution |
| hermes | hermes-whatsapp-bridge 1.0.0 | third-party | MIT |
| hermes | hindsight-client 0.6.1 | third-party | MIT |
| hermes | node 22.22.2 | third-party | LicenseRef-Node-22.22.2-Distribution |
| keycloak | jrt-fs 21.0.6 | owned-runtime-subrecord | LicenseRef-OpenJDK-21.0.6-JRTFS-Terms |
| keycloak | quarkus-run 26.0.8 | generated-launcher-descriptor | Apache-2.0 |
| memory-v4 | python 3.12.14 | third-party | LicenseRef-CPython-3.12.14-Distribution |
| postgresql | .postgresql-rundeps 20250204.203554 | zero-payload-package-manager-descriptor | NONE |
| postgresql | github.com/tianon/gosu UNKNOWN | third-party | Apache-2.0 |
| postgresql | postgresql 16.6 | third-party | PostgreSQL |
| reference-application | python 3.12.14 | third-party | LicenseRef-CPython-3.12.14-Distribution |
| unify-core | @aquiero/contracts 0.1.0 | first-party-restricted | LicenseRef-UNIFY-FirstParty-Proprietary |
| unify-core | @aquiero/gateway 0.1.0 | first-party-restricted | LicenseRef-UNIFY-FirstParty-Proprietary |
| unify-core | node 22.23.2 | third-party | LicenseRef-Node-22.23.2-Distribution |
| uniui | node 22.23.2 | third-party | LicenseRef-Node-22.23.2-Distribution |

## Individual rationale and evidence

### caddy / caddy / 948b704c27397904
Scanner pseudo-version is build VCS metadata, not a published caddy module release. Identify as the Caddy 2.10.2 distribution main record, corroborated by compiled dependency and vendor declaration. Dependent modules remain separately inventoried.

Evidence SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

### caddy / github.com/antlr4-go/antlr/v4 / 52bc4586ef22a868
Three conditions, including non-endorsement; retain ANTLR copyright and complete disclaimer.

Evidence SHA-256: `683fcd416d83b64781e229a3c2a598462fbf55c5c9fea54be244766b22c033cf`

### caddy / github.com/caddyserver/certmagic / cd97832ab16a5c2f
Complete Apache 2.0 document; appendix placeholder is not missing licence metadata.

Evidence SHA-256: `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`

### caddy / github.com/cloudflare/circl / 877a806ebf57e2ef
Cloudflare and Go copyright blocks both carry BSD-3-Clause; preserve ecc/p384 attribution too.

Evidence SHA-256: `b0da1764fe4d13d610b695536fc3f2ebc362482d053a1cd258e36975bc6b97a7`, `18951c084f68bce792efa2037685466628ebc1c67f4bff8b7147f3d5050e50a4`

### caddy / github.com/coreos/go-oidc/v3 / 3f0b77508aaee303
Complete Apache 2.0 plus distinct CoreOS NOTICE; do not drop NOTICE.

Evidence SHA-256: `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14`, `dccd26c6fd9c296daf44d0bc56bb4efc566edd4880381b3331c9a63e6e471338`

### caddy / github.com/dustin/go-humanize / e8a1ce1c799a0126
MIT grant/condition/disclaimer followed by an informational opensource.org URL; retain full text.

Evidence SHA-256: `a973b4498c13eb74baa2a8e5c351426a6826f2fcdd909916dbe53ee2e755fd71`

### caddy / github.com/go-logr/logr / 783487354d8c2a0f
Complete Apache 2.0; root licence metadata resolved, obligations remain separate.

Evidence SHA-256: `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`

### caddy / github.com/google/cel-go / c7242c912e4a02f0
Apache applies generally; common/types/pb/equal.go has an additional Go BSD-3-Clause block. Not Apache-only.

Evidence SHA-256: `4cdb9af102dfbb0ca03d87d6f650a505df098646a4080f4665b389ad9c6caa02`

### caddy / github.com/google/go-tspi / 3351194736e767bc
Complete Apache 2.0 document.

Evidence SHA-256: `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14`

### caddy / github.com/grpc-ecosystem/grpc-gateway/v2 / 7a65e90a74c6bdd3
Gengo root and internal/casing Go attribution each have three-condition BSD terms.

Evidence SHA-256: `a15b1d1b168954c92ff7fb1620382418f7c72f4f4d251ee791d1098ad68ab0c4`, `20873bd48d04a4e4075ee881ec2a5f3a3b14bf4920018b1131a7c52ec9b4a318`

### caddy / github.com/klauspost/compress / 799d7d87601f5386
Complete root and nested licence texts: BSD default, Apache gzhttp, MIT designated subdirectories. Source module ZIP matches the h1 checksum embedded in the frozen binary; object-code subcomponent applicability remains Step 3.

Evidence SHA-256: `0d9e582ee4bff57bf1189c9e514e6da7ce277f9cd3bc2d488b22fbb39a6d87cf`, `2252a5b1e2b1d3663b53ea77051b8ed065cb9270a3d1174d5d6ead8a2de051b6`, `6a358d2540ca14048f02d366f23787c0a480157e58f058113f0e27168dd4e447`, `f69f157b0be75da373605dbc8bbf142e8924ee82d8f44f11bcaf351335bf98cf`, `08683b14bda8ae3538abf19e1879e853a39e3b8276a8d673363b529d15a61c1a`, `8582c87d9a6baa28f7827c5205b7d16c3179bc794ebd4c7cc287c49a89b7eaa1`, `10fa24a602fde465db603cd5d546e37e33642a73cd24ddf5910be81724fec8b2`, `f69f157b0be75da373605dbc8bbf142e8924ee82d8f44f11bcaf351335bf98cf`, `d4ff111fa30ac75e28dca3868de957a3b73ff50b76bc4b8fe5c3a1f008d26703`, `f566a9f97bacdaf00d9f21dd991e81dc11201c4e016c86b470799429a1c9a79c`

### caddy / github.com/munnerz/goautoneg / 1eff95415d0a4c88
Three unnumbered conditions include Open Knowledge Foundation non-endorsement; retain whole document.

Evidence SHA-256: `aa1376b9bc5dea6f30cdefde40c176a254f247d2814d0a9929395138631b2ae0`

### caddy / github.com/pires/go-proxyproto / f812beb1e8db1a85
Complete Apache 2.0 with Paulo Pires appendix attribution.

Evidence SHA-256: `666f1951be1d543e744818d232bb311a4a310fd1d344288642c796fca39af3c7`

### caddy / github.com/russross/blackfriday/v2 / c1d98cbce7016709
Markdown quotation formatting surrounds the two-condition Simplified BSD text; no third condition.

Evidence SHA-256: `75e1ca97a84a9da6051dee0114333388216f2c4a5a028296b882ff3d57274735`

### caddy / github.com/shopspring/decimal / 12a6bb94d9e44380
Two MIT grants, Spring and upstream fpd/Oguz Bilgic; retain both, not just the first block.

Evidence SHA-256: `b92ba0f6ee02f2309628bfdadb123668a17c016e475ba477b857d33470d9d625`

### caddy / github.com/zeebo/blake3 / e539d7c05ecc6ea4
Explicit CC0 1.0 dedication and complete legal code, including fallback licence and limitations; not an unsupported public-domain assertion.

Evidence SHA-256: `0589f544f68ffc436e6e21efec2cf7cc2dbb2ac09ce6cb8a8cdb75ab74489716`

### caddy / gopkg.in/yaml.v3 / 36a4e38fe477b839
MIT for the enumerated libyaml-derived files; Apache 2.0 for remaining files. This is not a choice of either licence. NOTICE retained.

Evidence SHA-256: `d18f6323b71b0b768bb5e9616e36da390fbd39369a81807cca352de4e4e6aa0b`, `f6c2dd3a67b576eafb89b80200b8b1627230bf3821a0c14cb99a22ac19107d00`

### hermes / @aquiero/contracts / 3ad0ccddf1b6e8c6
Existing proprietary/restricted declaration, not SPDX Unlicense and not an OSS exemption. Package identity is byte-bound to repository manifest. Historical ALICA Ltd wording is a separate unresolved commercial/legal correction, not validated here.

Evidence SHA-256: `dc03a761fbe0f24b11b43fc168994705c4d14475654ad2eaf8e0bcae5dd7712d`, `1808a6d047b19a80e1ef601413d2f772ff629a0a4bd6c1dfdaa70cd448dba32f`

### hermes / @aquiero/hermes-control-adapter / 2b43b8db6abc5517
Existing proprietary/restricted declaration, not SPDX Unlicense and not an OSS exemption. Package identity is byte-bound to repository manifest. Historical ALICA Ltd wording is a separate unresolved commercial/legal correction, not validated here.

Evidence SHA-256: `fb8b2575a9bc2d800dc3cd4a9ab161fb632d186750004ade5ff812fc17ae2c9e`, `1808a6d047b19a80e1ef601413d2f772ff629a0a4bd6c1dfdaa70cd448dba32f`

### hermes / github.com/docker/cli/cmd/docker / 85c1a1d5545cca6a
UNKNOWN Go main-module version resolves to Debian docker-cli 26.1.5+dfsg1-9+b13, source docker.io 26.1.5+dfsg1-9. Package-manager file digest matches this exact binary. Preserve complete Debian copyright with per-file/packaging terms; do not apply GPL packaging terms indiscriminately to all Docker code.

Evidence SHA-256: `e4e52839404b4685b26e99169fb7f6be7776276d10ccf422e2b208545e6168e5`

### hermes / hermes-whatsapp-bridge / 94ea8e260480223e
Bridge is within the shipped Hermes repository root MIT scope. Its npm private flag is not a proprietary licence. Baileys and other dependencies retain separate records and obligations.

Evidence SHA-256: `51678e5e739149c050c257592cd449ecbb8d306c308cf6698cc82bc3092e6ca6`, `821556e6336796450ab852d375117b48a4887e71d255794fd6318d99982a5ab6`

### hermes / hindsight-client / 944a02cefeef02c9
Wheel omitted licence metadata. Installed client payload matches the published wheel and the exact tagged source tree, whose root supplies the MIT licence; this is not a name-only or latest-version inference.

Evidence SHA-256: `a4644e25544a427aca3e5c547f1485ffa15e52be28707ebf7ee21db67fa31fc3`, `01fde0bedf83bdc185065d7af524a61690efe576a67f922eaff3a1280c17b63a`

### hermes / node / 2acd79d760529caa
Exact upstream release executable matches shipped bytes. Preserve the complete Node licence bundle, including separately licensed embedded libraries; do not label the whole runtime MIT-only.

Evidence SHA-256: `c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4`

### keycloak / jrt-fs / d930e17b592cae0b
JAR is byte-bound to the installed Red Hat OpenJDK package and Java 21.0.6 release. Supplied GPL and conditional exceptions are explicit, not missing metadata. Evaluate source/linking/exception applicability in Steps 3–4; do not infer an unconditional exception for every file.

Evidence SHA-256: `5d99dd2027ce21e9a988d49f18e186b51c76d6b30e56e29782b1d689ee3edd56`, `f68e1348ddde60139aecac367a57e12666ac2268203370288e38305229a4f249`, `4b9abebc4338048a7c2dc184e9f800deb349366bdf28eb23c2677a77b4c87726`, `75292f03bf23d3db7c985aecc191029b93883200721ed23ed34a2e601463df33`

### keycloak / quarkus-run / dabf0c635baf2f49
Manifest-only launcher descriptor, not an unidentified independent Java library. Keycloak root Apache declaration retained. Referenced classpath JARs remain separately licensed/inventoried.

Evidence SHA-256: `49c294907d5e0746bab6c1f9633a686993b8e5ce394ddeeccbd56ac84275748a`, `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

### memory-v4 / python / b99eed5b3f033319
Shipped version header and complete interpreter licence/history identify CPython 3.12.14. Preserve historical and bundled terms, not a PSF-only assertion for the whole distribution.

Evidence SHA-256: `3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf`, `66ff726e200a2eba15cfedee752bf6a59e20d6741a7c45f7a2c424dea649f473`

### postgresql / .postgresql-rundeps / 96ada3e2ced9b39a
Generated apk virtual dependency record contains no software payload or owned files. No independent component licence applies to this record; every actual dependency remains in compliance scope.

Evidence SHA-256: `2768bd45a803516fa22835feeba0689517cbed504b6b7027723c9f16aca98d2d`

### postgresql / github.com/tianon/gosu / c13a9da2e175805c
UNKNOWN Go devel module version resolves to gosu 1.17 through byte equality with its exact upstream release binary and matching image environment. Upstream 1.17 Apache licence supplied.

Evidence SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

### postgresql / postgresql / 5a3f0a1e62acfcbf
Installed version header and image PG_VERSION agree on 16.6; exact REL_16_6 COPYRIGHT supplies the PostgreSQL licence. This does not clear separately linked libraries.

Evidence SHA-256: `c498602f5676e7b3b7f9046dc52962a85438f487a2de35ade2ecc7beaa007859`, `9bf20ee493926a7e17a74bc7f05089fbc014269667b1540bc35a6b194a40c9de`

### reference-application / python / dbf39d12a879b0cd
Shipped version header and complete interpreter licence/history identify CPython 3.12.14. Preserve historical and bundled terms, not a PSF-only assertion for the whole distribution.

Evidence SHA-256: `3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf`, `66ff726e200a2eba15cfedee752bf6a59e20d6741a7c45f7a2c424dea649f473`

### unify-core / @aquiero/contracts / 055b0b7f0842a128
Existing proprietary/restricted declaration, not SPDX Unlicense and not an OSS exemption. Package identity is byte-bound to repository manifest. Historical ALICA Ltd wording is a separate unresolved commercial/legal correction, not validated here.

Evidence SHA-256: `dc03a761fbe0f24b11b43fc168994705c4d14475654ad2eaf8e0bcae5dd7712d`, `1808a6d047b19a80e1ef601413d2f772ff629a0a4bd6c1dfdaa70cd448dba32f`

### unify-core / @aquiero/gateway / 33675c3940251a41
Existing proprietary/restricted declaration, not SPDX Unlicense and not an OSS exemption. Package identity is byte-bound to repository manifest. Historical ALICA Ltd wording is a separate unresolved commercial/legal correction, not validated here.

Evidence SHA-256: `ef36ebe0df59e68a6f545e5408997f202ef5eb755d75816a7f060c3d63b411b1`, `1808a6d047b19a80e1ef601413d2f772ff629a0a4bd6c1dfdaa70cd448dba32f`

### unify-core / node / eb74c04ff5d071a8
Exact upstream release executable matches shipped bytes. Preserve the complete Node licence bundle, including separately licensed embedded libraries; do not label the whole runtime MIT-only.

Evidence SHA-256: `c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4`

### uniui / node / 521ad10f0530e7f0
Exact upstream release executable matches shipped bytes. Preserve the complete Node licence bundle, including separately licensed embedded libraries; do not label the whole runtime MIT-only.

Evidence SHA-256: `c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4`
