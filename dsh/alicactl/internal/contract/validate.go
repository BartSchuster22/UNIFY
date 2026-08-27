package contract

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	digestPattern  = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	commitPattern  = regexp.MustCompile(`^[a-f0-9]{40}$`)
	idPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}$`)
	releasePattern = regexp.MustCompile(`^rel_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	semverPattern  = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`)
)

var requiredComponents = []string{
	"ainba-anchor", "alica-runtime", "alicactl", "caddy", "doghouse-node", "herman-runtime",
	"keycloak", "memory-v4", "operations-jobs", "postgresql", "unify-core", "uniui",
}

var requiredDataAuthorities = []string{
	"ainba-data", "alica-state", "doghouse-state", "herman-state", "identity-postgres",
	"lifecycle-state", "memory-v4", "unify-postgres",
}

func ValidateManifest(m *Manifest) []string {
	errors := []string{}
	add := func(format string, args ...any) { errors = append(errors, fmt.Sprintf(format, args...)) }
	if m.SchemaVersion != "alica-release/v1" {
		add("schemaVersion must be alica-release/v1")
	}
	if m.CanonicalEncoding != "alica-canonical-json/v1" {
		add("canonicalEncoding must be alica-canonical-json/v1")
	}
	if !releasePattern.MatchString(m.ReleaseID) {
		add("releaseId must be rel_<uuid-v7>")
	}
	if !semverPattern.MatchString(m.ReleaseVersion) {
		add("releaseVersion must be SemVer")
	}
	if parsed, err := time.Parse(time.RFC3339, m.CreatedAt); err != nil || parsed.Format(time.RFC3339) != m.CreatedAt {
		add("createdAt must be canonical RFC3339 UTC seconds")
	}
	if m.CellContract != "alica-cell/v0.1" {
		add("cellContract must be alica-cell/v0.1")
	}
	if !contains([]string{"development", "candidate", "stable", "lts", "hotfix", "withdrawn", "revoked"}, m.ReleaseClass) {
		add("releaseClass is unsupported")
	}
	if (m.ReleaseClass == "withdrawn" || m.ReleaseClass == "revoked") && m.Installable {
		add("withdrawn/revoked release cannot be installable")
	}

	if m.Product.ProductID != "com.alica.community-dsh" {
		add("product.productId does not match D0")
	}
	if m.Product.ReleaseLine != "1.0" {
		add("product.releaseLine does not match D0")
	}
	if m.Product.Profile != "dsh-minimal/v1" {
		add("product.profile does not match D0")
	}
	if m.Product.FreezeDigest != "sha256:084ee1cfe6a16afcfac7178484afd359c7f9012d69552ce37839594a39c4b3b1" {
		add("product.freezeDigest does not match D0")
	}
	if m.Product.BinaryLicense != "ALICA-Community-DSH-EULA-1.0" {
		add("product.binaryLicense does not match D0")
	}
	if m.Product.EULADigest != "sha256:3b172e3850816750ff7b5a7d6d4b9f311f5c745159e201f42fea647c4dad1f3c" {
		add("product.eulaDigest does not match D0")
	}
	if len(m.Product.CentralRuntime) != 0 {
		add("product.centralRuntimeDependencies must be empty")
	}
	if len(m.Profiles) != 1 || m.Profiles[0] != "dsh-minimal/v1" {
		add("profiles must contain only dsh-minimal/v1")
	}

	if len(m.Platforms) != 1 {
		add("exactly one D1 platform is required")
	} else {
		validatePlatform(m.Platforms[0], add)
	}
	if len(m.Sources) == 0 || len(m.Sources) > 32 {
		add("sources count must be 1..32")
	}
	seenSources := map[string]bool{}
	for i, source := range m.Sources {
		if source.Repository == "" || len(source.Repository) > 256 {
			add("sources[%d].repository is invalid", i)
		}
		if seenSources[source.Repository] {
			add("duplicate source repository %s", source.Repository)
		}
		seenSources[source.Repository] = true
		if !commitPattern.MatchString(source.Commit) {
			add("sources[%d].commit is invalid", i)
		}
		if !digestPattern.MatchString(source.TreeDigest) {
			add("sources[%d].treeDigest is invalid", i)
		}
	}

	componentIDs := map[string]Component{}
	if len(m.Components) != len(requiredComponents) {
		add("components must contain the exact dsh-minimal/v1 set")
	}
	for i, component := range m.Components {
		if !idPattern.MatchString(component.ComponentID) {
			add("components[%d].componentId is invalid", i)
		}
		if _, exists := componentIDs[component.ComponentID]; exists {
			add("duplicate component %s", component.ComponentID)
		}
		componentIDs[component.ComponentID] = component
		validateComponent(i, component, add)
	}
	if !equalStringSets(mapKeys(componentIDs), requiredComponents) {
		add("component IDs do not match required DSH set")
	}
	validateTopology(m, componentIDs, add)
	validateCompatibility(m.Compatibility, add)
	validateMigrationPlan(m.MigrationPlan, add)
	validateRollback(m.Rollback, add)

	dataAuthorities := map[string]bool{}
	restoreOrders := map[int]bool{}
	for i, unit := range m.DataUnits {
		if !idPattern.MatchString(unit.Authority) {
			add("dataUnits[%d].authority is invalid", i)
		}
		if dataAuthorities[unit.Authority] {
			add("duplicate data authority %s", unit.Authority)
		}
		dataAuthorities[unit.Authority] = true
		if unit.BackupContract == "" || len(unit.BackupContract) > 128 {
			add("dataUnits[%d].backupContract is invalid", i)
		}
		if unit.RestoreOrder <= 0 || restoreOrders[unit.RestoreOrder] {
			add("dataUnits[%d].restoreOrder must be unique and positive", i)
		}
		restoreOrders[unit.RestoreOrder] = true
	}
	if !equalStringSets(mapBoolKeys(dataAuthorities), requiredDataAuthorities) {
		add("data authority set is incomplete")
	}

	endpointIDs := map[string]bool{}
	for i, endpoint := range m.Endpoints {
		if !idPattern.MatchString(endpoint.ID) || endpointIDs[endpoint.ID] {
			add("endpoints[%d].id is invalid or duplicate", i)
		}
		endpointIDs[endpoint.ID] = true
		if !contains([]string{"public", "private"}, endpoint.Exposure) {
			add("endpoints[%d].exposure is invalid", i)
		}
		if !contains([]string{"http", "https", "tcp"}, endpoint.Protocol) || endpoint.Port < 1 || endpoint.Port > 65535 {
			add("endpoints[%d] protocol/port is invalid", i)
		}
		if _, ok := componentIDs[endpoint.Owner]; !ok {
			add("endpoints[%d].owner is unknown", i)
		}
	}
	if len(m.Endpoints) != 2 || !endpointIDs["alica-http-redirect"] || !endpointIDs["alica-https"] {
		add("endpoint set must be exact HTTP redirect plus HTTPS")
	}

	secretRefs := map[string]bool{}
	for i, requirement := range m.SecretRequirements {
		if !strings.HasPrefix(requirement.Reference, "secret://cell/") || strings.ContainsAny(requirement.Reference, "@?#") || len(requirement.Reference) > 160 {
			add("secretRequirements[%d].reference is unsafe", i)
		}
		if secretRefs[requirement.Reference] {
			add("duplicate secret reference %s", requirement.Reference)
		}
		secretRefs[requirement.Reference] = true
		if requirement.Class == "" || len(requirement.Consumers) == 0 {
			add("secretRequirements[%d] class/consumers required", i)
		}
		for _, consumer := range requirement.Consumers {
			if _, ok := componentIDs[consumer]; !ok {
				add("secret consumer %s is unknown", consumer)
			}
		}
	}
	if len(m.SecretRequirements) == 0 {
		add("secretRequirements cannot be empty")
	}
	validateArtifactDescriptor("acceptanceSuite", m.AcceptanceSuite, add)
	validateArtifactDescriptor("releaseNotes", m.ReleaseNotes, add)
	if m.AcceptanceSuite.ID != "alica-cell-acceptance/v1" {
		add("acceptanceSuite.id is invalid")
	}
	if duplicateStrings(m.KnownRisks) {
		add("knownRisks must be unique")
	}
	if duplicateStrings(m.IrreversibleChanges) {
		add("irreversibleChanges must be unique")
	}
	for _, text := range append(append([]string{}, m.KnownRisks...), m.IrreversibleChanges...) {
		if text == "" || len(text) > 512 {
			add("risk/change entries must be 1..512 characters")
		}
	}

	sort.Strings(errors)
	return errors
}

func validatePlatform(p Platform, add func(string, ...any)) {
	if p.OSID != "debian" || p.OSVersion != "13" || p.Architecture != "amd64" || p.Init != "systemd" {
		add("platform must be Debian 13/amd64/systemd")
	}
	if p.Docker.MinimumInclusive != "28.4.0" || p.Docker.MaximumExclusive != "29.0.0" {
		add("Docker range does not match D0")
	}
	if p.Compose.MinimumInclusive != "2.39.4" || p.Compose.MaximumExclusive != "3.0.0" {
		add("Compose range does not match D0")
	}
	if p.Minimum.VCPU != 4 || p.Minimum.MemoryBytes != 8589934592 || p.Minimum.FreeDiskBytes != 107374182400 {
		add("minimum resources do not match D0")
	}
	if p.UpgradeHeadroomBytes < 21474836480 {
		add("upgradeHeadroomBytes must be at least 20 GiB")
	}
}

func validateComponent(i int, c Component, add func(string, ...any)) {
	if !idPattern.MatchString(c.Authority) {
		add("components[%d].authority is invalid", i)
	}
	if !semverPattern.MatchString(c.Version) {
		add("components[%d].version is invalid", i)
	}
	if !contains([]string{"oci-image", "host-binary", "host-unit-bundle"}, c.Kind) || !contains([]string{"oci-container", "host-binary", "systemd-units"}, c.Realization) {
		add("components[%d].kind/realization is invalid", i)
	}
	if !digestPattern.MatchString(c.Digest) {
		add("components[%d].digest is invalid", i)
	}
	if c.SignaturePolicy != "alica-executable/v1" {
		add("components[%d].signaturePolicy is invalid", i)
	}
	if !validArtifactURI(c.Artifact, c.Digest) {
		add("components[%d].artifact is not immutable or contains credentials", i)
	}
	validateArtifactDescriptor(fmt.Sprintf("components[%d].sbom", i), c.SBOM, add)
	validateArtifactDescriptor(fmt.Sprintf("components[%d].provenance", i), c.Provenance, add)
	if c.ComponentContract == "" || len(c.ComponentContract) > 128 {
		add("components[%d].componentContract is invalid", i)
	}
	if c.ConfigSchema.ID == "" || !digestPattern.MatchString(c.ConfigSchema.Digest) {
		add("components[%d].configSchema is invalid", i)
	}
	if duplicateStrings(c.Provides) || duplicateStrings(c.Requires) {
		add("components[%d] provides/requires must be unique", i)
	}
	if c.DataSchema.Authority == "" || c.DataSchema.Target == "" {
		add("components[%d].dataSchema must be explicit", i)
	}
}

func validateArtifactDescriptor(name string, a ArtifactDescriptor, add func(string, ...any)) {
	if a.ID == "" || len(a.ID) > 128 || !digestPattern.MatchString(a.Digest) || !validArtifactURI(a.Artifact, a.Digest) {
		add("%s is invalid or not immutable", name)
	}
}

func validArtifactURI(raw, digest string) bool {
	if raw == "" || len(raw) > 512 || strings.Contains(raw, "\\") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if !contains([]string{"oci", "file"}, u.Scheme) {
		return false
	}
	lowerPath := strings.ToLower(u.EscapedPath())
	if strings.Contains(lowerPath, "/../") || strings.Contains(lowerPath, "%2e") {
		return false
	}
	return strings.HasSuffix(raw, "@"+digest)
}

func validateTopology(m *Manifest, components map[string]Component, add func(string, ...any)) {
	t := m.Topology
	if t.Project != "alica" {
		add("topology.project must be alica")
	}
	if t.Labels.CellID != "com.alica.cell.id" || t.Labels.ReleaseID != "com.alica.release.id" || t.Labels.ComponentID != "com.alica.component.id" || t.Labels.Managed != "com.alica.managed" {
		add("topology labels are not canonical")
	}
	networks := map[string]bool{}
	for i, n := range t.Networks {
		if !idPattern.MatchString(n.ID) || networks[n.ID] {
			add("topology.networks[%d] invalid or duplicate", i)
		}
		networks[n.ID] = true
	}
	if !equalStringSets(mapBoolKeys(networks), []string{"app", "assurance", "data", "edge", "frameworks"}) {
		add("topology network set is incomplete")
	}
	volumes := map[string]bool{}
	for i, v := range t.Volumes {
		if !idPattern.MatchString(v.ID) || volumes[v.ID] {
			add("topology.volumes[%d] invalid or duplicate", i)
		}
		volumes[v.ID] = true
		if v.Authority == "" {
			add("topology.volumes[%d].authority required", i)
		}
	}
	containers := map[string]bool{}
	for i, c := range t.Containers {
		component, ok := components[c.ComponentID]
		if !ok || component.Realization != "oci-container" {
			add("topology.containers[%d] component is unknown/not OCI", i)
		}
		if containers[c.ComponentID] {
			add("duplicate topology container %s", c.ComponentID)
		}
		containers[c.ComponentID] = true
		if !idPattern.MatchString(c.Service) || duplicateStrings(c.Networks) || duplicateStrings(c.Volumes) {
			add("topology.containers[%d] service/networks/volumes invalid", i)
		}
		for _, n := range c.Networks {
			if !networks[n] {
				add("container %s references unknown network %s", c.ComponentID, n)
			}
		}
		for _, v := range c.Volumes {
			if !volumes[v] {
				add("container %s references unknown volume %s", c.ComponentID, v)
			}
		}
		for _, p := range c.PublishedPorts {
			if c.ComponentID != "caddy" || p.HostIP != "0.0.0.0" || p.Published < 1 || p.Published > 65535 || p.Target < 1 || p.Target > 65535 || p.Protocol != "tcp" {
				add("container %s has forbidden published port", c.ComponentID)
			}
		}
	}
	for id, c := range components {
		if c.Realization == "oci-container" && !containers[id] {
			add("OCI component %s has no topology container", id)
		}
	}
	units := map[string]bool{}
	for i, unit := range t.HostUnits {
		c, ok := components[unit.ComponentID]
		if !ok || c.Realization != "systemd-units" {
			add("topology.hostUnits[%d] component is unknown/not unit bundle", i)
		}
		if unit.Unit == "" || !strings.HasSuffix(unit.Unit, ".service") && !strings.HasSuffix(unit.Unit, ".timer") {
			add("topology.hostUnits[%d].unit invalid", i)
		}
		if units[unit.Unit] {
			add("duplicate host unit %s", unit.Unit)
		}
		units[unit.Unit] = true
	}
	for id, c := range components {
		if c.Realization == "systemd-units" {
			found := false
			for _, unit := range t.HostUnits {
				if unit.ComponentID == id {
					found = true
				}
			}
			if !found {
				add("unit component %s has no host units", id)
			}
		}
	}
}

func validateCompatibility(c Compatibility, add func(string, ...any)) {
	seen := map[string]bool{}
	for i, edge := range c.SupportedOrigins {
		if !releasePattern.MatchString(edge.ReleaseID) || !digestPattern.MatchString(edge.ManifestDigest) || seen[edge.ReleaseID] || len(edge.Profiles) == 0 || len(edge.Evidence) == 0 {
			add("compatibility.supportedOrigins[%d] is invalid", i)
		}
		seen[edge.ReleaseID] = true
	}
	if !c.FreshInstall && len(c.SupportedOrigins) == 0 {
		add("compatibility must allow fresh install or exact origins")
	}
}

func validateMigrationPlan(p MigrationPlan, add func(string, ...any)) {
	if p.PlanID == "" || len(p.PlanID) > 128 {
		add("migrationPlan.planId is invalid")
	}
	steps := map[string]MigrationStep{}
	for i, step := range p.Steps {
		if !idPattern.MatchString(step.StepID) || steps[step.StepID].StepID != "" || !digestPattern.MatchString(step.ToolDigest) || step.Authority == "" || step.From == "" || step.To == "" || step.TimeoutSeconds < 1 || step.Verify == "" || !contains([]string{"recover", "restore", "forward_recover", "hold", "application_rollback_forward_schema"}, step.FailureDisposition) {
			add("migrationPlan.steps[%d] is invalid", i)
		}
		steps[step.StepID] = step
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if visited[id] {
			return
		}
		if visiting[id] {
			add("migration plan contains a cycle at %s", id)
			return
		}
		visiting[id] = true
		for _, dep := range steps[id].DependsOn {
			if _, ok := steps[dep]; !ok {
				add("migration step %s has unknown dependency %s", id, dep)
			} else {
				visit(dep)
			}
		}
		visiting[id] = false
		visited[id] = true
	}
	for id := range steps {
		visit(id)
	}
}

func validateRollback(r Rollback, add func(string, ...any)) {
	if r.ForwardRecovery == "" || len(r.ForwardRecovery) > 256 {
		add("rollback.forwardRecovery is required")
	}
	seen := map[string]bool{}
	for i, t := range r.SupportedTargets {
		if !releasePattern.MatchString(t.ReleaseID) || seen[t.ReleaseID] || !contains([]string{"definition_rollback", "application_rollback_forward_schema", "restore_rollback", "forward_recovery_only", "no_automatic_recovery_hold"}, t.Class) || t.Evidence == "" {
			add("rollback.supportedTargets[%d] is invalid", i)
		}
		seen[t.ReleaseID] = true
	}
}

func ParseVersion(value string) ([3]int, error) {
	var result [3]int
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if index := strings.IndexAny(value, "+-"); index >= 0 {
		value = value[:index]
	}
	parts := strings.Split(value, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return result, fmt.Errorf("invalid version %q", value)
	}
	for i, part := range parts {
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return result, fmt.Errorf("invalid version %q", value)
		}
		result[i] = parsed
	}
	return result, nil
}

func VersionInRange(value string, r VersionRange) bool {
	v, e1 := ParseVersion(value)
	min, e2 := ParseVersion(r.MinimumInclusive)
	max, e3 := ParseVersion(r.MaximumExclusive)
	return e1 == nil && e2 == nil && e3 == nil && compareVersion(v, min) >= 0 && compareVersion(v, max) < 0
}
func compareVersion(a, b [3]int) int {
	for i := 0; i < 3; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}
func contains(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
func duplicateStrings(values []string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			return true
		}
		seen[value] = true
	}
	return false
}
func mapKeys(values map[string]Component) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return result
}
func mapBoolKeys(values map[string]bool) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return result
}
func equalStringSets(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	left, right := append([]string{}, a...), append([]string{}, b...)
	sort.Strings(left)
	sort.Strings(right)
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
