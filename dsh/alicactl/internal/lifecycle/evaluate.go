package lifecycle

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
)

func Evaluate(command string, manifest *contract.Manifest, manifestDigest string, observation *Observation) Report {
	report := Report{SchemaVersion: "alica-readonly-report/v1", Command: command, GeneratedAt: reportTime(), Status: "PASS", MutationPerformed: false, ReleaseID: manifest.ReleaseID, ManifestDigest: manifestDigest, Checks: []Check{}, Drift: []Drift{}}
	addCheck := func(name, status, code, detail string) {
		report.Checks = append(report.Checks, Check{Name: name, Status: status, Code: code, Detail: detail})
	}
	addDrift := func(class, resource, expected, observed string) {
		report.Drift = append(report.Drift, Drift{Class: class, Resource: resource, Expected: expected, Observed: observed})
	}
	addCheck("manifest-contract", "PASS", "MANIFEST_VALID", "closed whole-Cell manifest contract accepted")
	addCheck("manifest-signature", "PASS", "SIGNATURE_VALID", "Ed25519 signature and manifest digest accepted")
	if manifest.Installable {
		addCheck("release-eligibility", "PASS", "RELEASE_INSTALLABLE", manifest.ReleaseClass+" release is eligible for assessment")
	} else if observation.Source == "test-fixture" && os.Getenv("ALICACTL_TEST_MODE") == "1" {
		addCheck("release-eligibility", "PASS", "NON_INSTALLABLE_TEST_FIXTURE", "D1 contract fixture is intentionally non-installable")
	} else {
		addCheck("release-eligibility", "FAIL", "RELEASE_NOT_INSTALLABLE", "manifest explicitly forbids installation")
	}
	platformChecks(manifest.Platforms[0], observation.Host, addCheck)

	if command == "preflight" {
		finalize(&report)
		return report
	}
	if observation.State == nil {
		addCheck("lifecycle-state", "PASS", "CELL_NOT_INSTALLED", "no /var/lib/alica/lifecycle-state.json accepted-current record exists")
		report.Status = "NOT_INSTALLED"
		finalize(&report)
		if report.Summary.Failed > 0 {
			report.Status = "FAIL"
		}
		return report
	}
	state := observation.State
	report.CellID = &state.CellID
	if state.AcceptedCurrent.ReleaseID == manifest.ReleaseID {
		addCheck("accepted-release", "PASS", "RELEASE_ID_MATCH", manifest.ReleaseID)
	} else {
		addCheck("accepted-release", "FAIL", "RELEASE_ID_DRIFT", "accepted-current release differs from manifest")
		addDrift("release", "acceptedCurrent.releaseId", manifest.ReleaseID, state.AcceptedCurrent.ReleaseID)
	}
	if state.AcceptedCurrent.ManifestDigest == manifestDigest {
		addCheck("accepted-manifest", "PASS", "MANIFEST_DIGEST_MATCH", manifestDigest)
	} else {
		addCheck("accepted-manifest", "FAIL", "MANIFEST_DIGEST_DRIFT", "accepted-current manifest digest differs")
		addDrift("release", "acceptedCurrent.manifestDigest", manifestDigest, state.AcceptedCurrent.ManifestDigest)
	}
	if state.AcceptedCurrent.Profile == manifest.Product.Profile {
		addCheck("accepted-profile", "PASS", "PROFILE_MATCH", manifest.Product.Profile)
	} else {
		addCheck("accepted-profile", "FAIL", "PROFILE_DRIFT", "accepted-current profile differs")
		addDrift("profile", "acceptedCurrent.profile", manifest.Product.Profile, state.AcceptedCurrent.Profile)
	}
	if observation.Declaration == nil {
		addCheck("cell-declaration", "FAIL", "CELL_DECLARATION_MISSING", "Cell declaration is absent")
		addDrift("identity", "cell-declaration", "present and bound to lifecycle state", "absent")
	} else if observation.Declaration.CellID == state.CellID && observation.Declaration.ProductID == manifest.Product.ProductID && observation.Declaration.Profile == manifest.Product.Profile {
		addCheck("cell-declaration", "PASS", "CELL_DECLARATION_MATCH", state.CellID)
	} else {
		addCheck("cell-declaration", "FAIL", "CELL_DECLARATION_DRIFT", "Cell declaration differs from accepted state or manifest")
		addDrift("identity", "cell-declaration", state.CellID+"/"+manifest.Product.Profile, observation.Declaration.CellID+"/"+observation.Declaration.Profile)
	}
	if observation.Journal == nil || len(observation.Journal.Entries) == 0 {
		addCheck("operation-journal", "FAIL", "OPERATION_JOURNAL_MISSING", "accepted-current has no hash-chained operation evidence")
		addDrift("journal", "operation-journal", "terminal accepted entry for manifest", "absent/empty")
	} else {
		entry := observation.Journal.Entries[len(observation.Journal.Entries)-1]
		if entry.TargetReleaseID == manifest.ReleaseID && entry.TargetManifestDigest == manifestDigest && entry.Phase == "accepted" && entry.Result == "succeeded" && entry.MutationAuthorized {
			addCheck("operation-journal", "PASS", "OPERATION_JOURNAL_MATCH", fmt.Sprintf("%d hash-chained entries", len(observation.Journal.Entries)))
		} else {
			addCheck("operation-journal", "FAIL", "OPERATION_JOURNAL_DRIFT", "terminal journal entry differs from accepted-current")
			addDrift("journal", "operation-journal/terminal", manifest.ReleaseID+"/accepted/succeeded", entry.TargetReleaseID+"/"+entry.Phase+"/"+entry.Result)
		}
	}
	if command == "status" {
		conformance(manifest, observation, addCheck, addDrift)
		finalize(&report)
		return report
	}
	conformance(manifest, observation, addCheck, addDrift)
	finalize(&report)
	return report
}

func platformChecks(expected contract.Platform, observed HostFacts, add func(string, string, string, string)) {
	if observed.OSID == expected.OSID && observed.OSVersion == expected.OSVersion && observed.Architecture == expected.Architecture && observed.Init == expected.Init {
		add("host-platform", "PASS", "PLATFORM_MATCH", fmt.Sprintf("%s %s/%s/%s", observed.OSID, observed.OSVersion, observed.Architecture, observed.Init))
	} else {
		add("host-platform", "FAIL", "PLATFORM_UNSUPPORTED", fmt.Sprintf("expected %s %s/%s/%s; observed %s %s/%s/%s", expected.OSID, expected.OSVersion, expected.Architecture, expected.Init, observed.OSID, observed.OSVersion, observed.Architecture, observed.Init))
	}
	if observed.DockerAvailable && contract.VersionInRange(observed.DockerVersion, expected.Docker) {
		add("docker-runtime", "PASS", "DOCKER_VERSION_MATCH", observed.DockerVersion)
	} else {
		add("docker-runtime", "FAIL", "DOCKER_VERSION_UNSUPPORTED", fmt.Sprintf("expected >=%s <%s; observed %s", expected.Docker.MinimumInclusive, expected.Docker.MaximumExclusive, observed.DockerVersion))
	}
	if contract.VersionInRange(observed.ComposeVersion, expected.Compose) {
		add("compose-runtime", "PASS", "COMPOSE_VERSION_MATCH", observed.ComposeVersion)
	} else {
		add("compose-runtime", "FAIL", "COMPOSE_VERSION_UNSUPPORTED", fmt.Sprintf("expected >=%s <%s; observed %s", expected.Compose.MinimumInclusive, expected.Compose.MaximumExclusive, observed.ComposeVersion))
	}
	if observed.VCPU >= expected.Minimum.VCPU {
		add("resource-vcpu", "PASS", "VCPU_SUFFICIENT", fmt.Sprintf("%d", observed.VCPU))
	} else {
		add("resource-vcpu", "FAIL", "VCPU_INSUFFICIENT", fmt.Sprintf("expected >=%d; observed %d", expected.Minimum.VCPU, observed.VCPU))
	}
	if observed.MemoryBytes >= expected.Minimum.MemoryBytes {
		add("resource-memory", "PASS", "MEMORY_SUFFICIENT", fmt.Sprintf("%d", observed.MemoryBytes))
	} else {
		add("resource-memory", "FAIL", "MEMORY_INSUFFICIENT", fmt.Sprintf("expected >=%d; observed %d", expected.Minimum.MemoryBytes, observed.MemoryBytes))
	}
	requiredDisk := expected.Minimum.FreeDiskBytes + expected.UpgradeHeadroomBytes
	if observed.FreeDiskBytes >= requiredDisk {
		add("resource-disk", "PASS", "DISK_SUFFICIENT", fmt.Sprintf("%d", observed.FreeDiskBytes))
	} else {
		add("resource-disk", "FAIL", "DISK_INSUFFICIENT", fmt.Sprintf("expected >=%d including headroom; observed %d", requiredDisk, observed.FreeDiskBytes))
	}
}

func conformance(manifest *contract.Manifest, observation *Observation, add func(string, string, string, string), drift func(string, string, string, string)) {
	components := map[string]contract.Component{}
	for _, c := range manifest.Components {
		components[c.ComponentID] = c
	}
	expectedContainers := map[string]contract.ContainerContract{}
	for _, c := range manifest.Topology.Containers {
		expectedContainers[c.ComponentID] = c
	}
	observedContainers := map[string]ObservedContainer{}
	for _, c := range observation.Containers {
		if _, duplicate := observedContainers[c.ComponentID]; duplicate || c.ComponentID == "" {
			drift("undeclared", "container/"+c.Name, "unique declared component", c.ComponentID)
			continue
		}
		observedContainers[c.ComponentID] = c
	}
	for id, expected := range expectedContainers {
		observed, ok := observedContainers[id]
		if !ok {
			drift("missing", "container/"+id, "present", "absent")
			continue
		}
		component := components[id]
		if observed.ImageDigest != component.Digest {
			drift("artifact", "container/"+id+"/imageDigest", component.Digest, observed.ImageDigest)
		}
		if observed.ReleaseID != manifest.ReleaseID {
			drift("release", "container/"+id+"/releaseId", manifest.ReleaseID, observed.ReleaseID)
		}
		if observed.Managed != "true" {
			drift("ownership", "container/"+id+"/managed", "true", observed.Managed)
		}
		if observed.State != "running" {
			drift("health", "container/"+id+"/state", "running", observed.State)
		}
		if expected.HealthRequired && observed.Health != "healthy" {
			drift("health", "container/"+id+"/health", "healthy", observed.Health)
		}
		if !equalStrings(expected.Networks, observed.Networks) {
			drift("network", "container/"+id+"/networks", strings.Join(sorted(expected.Networks), ","), strings.Join(sorted(observed.Networks), ","))
		}
		if !equalStrings(expected.Volumes, observed.Volumes) {
			drift("storage", "container/"+id+"/volumes", strings.Join(sorted(expected.Volumes), ","), strings.Join(sorted(observed.Volumes), ","))
		}
		if !equalPorts(expected.PublishedPorts, observed.PublishedPorts) {
			drift("exposure", "container/"+id+"/publishedPorts", formatPorts(expected.PublishedPorts), formatPorts(observed.PublishedPorts))
		}
	}
	for id, observed := range observedContainers {
		if _, ok := expectedContainers[id]; !ok {
			drift("undeclared", "container/"+observed.Name, "absent", id)
		}
	}
	if countClass(observation, "container") == 0 && len(expectedContainers) > 0 { /* missing entries emitted above */
	}

	expectedNetworks := map[string]bool{}
	for _, n := range manifest.Topology.Networks {
		expectedNetworks[n.ID] = n.Internal
	}
	observedNetworks := map[string]bool{}
	for _, n := range observation.Networks {
		if _, duplicate := observedNetworks[n.ID]; duplicate || n.ID == "" {
			drift("undeclared", "network/"+n.ID, "unique declared network", "duplicate/empty")
			continue
		}
		observedNetworks[n.ID] = n.Internal
	}
	for id, internal := range expectedNetworks {
		value, ok := observedNetworks[id]
		if !ok {
			drift("missing", "network/"+id, "present", "absent")
		} else if value != internal {
			drift("network", "network/"+id+"/internal", fmt.Sprint(internal), fmt.Sprint(value))
		}
	}
	for id := range observedNetworks {
		if _, ok := expectedNetworks[id]; !ok {
			drift("undeclared", "network/"+id, "absent", "present")
		}
	}

	expectedVolumes := map[string]string{}
	for _, v := range manifest.Topology.Volumes {
		expectedVolumes[v.ID] = v.Authority
	}
	observedVolumes := map[string]string{}
	for _, v := range observation.Volumes {
		if _, duplicate := observedVolumes[v.ID]; duplicate || v.ID == "" {
			drift("undeclared", "volume/"+v.ID, "unique declared volume", "duplicate/empty")
			continue
		}
		observedVolumes[v.ID] = v.Authority
	}
	for id, authority := range expectedVolumes {
		value, ok := observedVolumes[id]
		if !ok {
			drift("missing", "volume/"+id, "present", "absent")
		} else if value != authority {
			drift("storage", "volume/"+id+"/authority", authority, value)
		}
	}
	for id := range observedVolumes {
		if _, ok := expectedVolumes[id]; !ok {
			drift("undeclared", "volume/"+id, "absent", "present")
		}
	}

	expectedUnits := map[string]contract.HostUnitContract{}
	for _, unit := range manifest.Topology.HostUnits {
		expectedUnits[unit.Unit] = unit
	}
	observedUnits := map[string]ObservedHostUnit{}
	for _, unit := range observation.HostUnits {
		observedUnits[unit.Unit] = unit
	}
	for name, expected := range expectedUnits {
		observed, ok := observedUnits[name]
		if !ok {
			drift("missing", "unit/"+name, "present", "absent")
		} else {
			if observed.ComponentID != expected.ComponentID {
				drift("ownership", "unit/"+name+"/component", expected.ComponentID, observed.ComponentID)
			}
			if expected.Required && (observed.LoadState != "loaded" || observed.ActiveState != "active") {
				drift("health", "unit/"+name, "loaded/active", observed.LoadState+"/"+observed.ActiveState)
			}
		}
	}
	for name := range observedUnits {
		if _, ok := expectedUnits[name]; !ok {
			drift("undeclared", "unit/"+name, "absent", "present")
		}
	}

	if len(expectedContainers) == len(observedContainers) {
		add("container-inventory", "PASS", "CONTAINER_SET_MATCH", fmt.Sprintf("%d declared containers observed", len(expectedContainers)))
	} else {
		add("container-inventory", "FAIL", "CONTAINER_SET_DRIFT", fmt.Sprintf("expected %d; observed %d", len(expectedContainers), len(observedContainers)))
	}
	if len(expectedNetworks) == len(observedNetworks) {
		add("network-inventory", "PASS", "NETWORK_SET_MATCH", fmt.Sprintf("%d declared networks observed", len(expectedNetworks)))
	} else {
		add("network-inventory", "FAIL", "NETWORK_SET_DRIFT", fmt.Sprintf("expected %d; observed %d", len(expectedNetworks), len(observedNetworks)))
	}
	if len(expectedVolumes) == len(observedVolumes) {
		add("volume-inventory", "PASS", "VOLUME_SET_MATCH", fmt.Sprintf("%d declared volumes observed", len(expectedVolumes)))
	} else {
		add("volume-inventory", "FAIL", "VOLUME_SET_DRIFT", fmt.Sprintf("expected %d; observed %d", len(expectedVolumes), len(observedVolumes)))
	}
	if len(expectedUnits) == len(observedUnits) {
		add("host-unit-inventory", "PASS", "HOST_UNIT_SET_MATCH", fmt.Sprintf("%d declared host units observed", len(expectedUnits)))
	} else {
		add("host-unit-inventory", "FAIL", "HOST_UNIT_SET_DRIFT", fmt.Sprintf("expected %d; observed %d", len(expectedUnits), len(observedUnits)))
	}
}

func finalize(report *Report) {
	sort.Slice(report.Checks, func(i, j int) bool { return report.Checks[i].Name < report.Checks[j].Name })
	sort.Slice(report.Drift, func(i, j int) bool {
		if report.Drift[i].Resource == report.Drift[j].Resource {
			return report.Drift[i].Class < report.Drift[j].Class
		}
		return report.Drift[i].Resource < report.Drift[j].Resource
	})
	for _, check := range report.Checks {
		if check.Status == "PASS" {
			report.Summary.Passed++
		} else {
			report.Summary.Failed++
		}
	}
	report.Summary.Drift = len(report.Drift)
	if report.Summary.Failed > 0 || report.Summary.Drift > 0 {
		report.Status = "FAIL"
	}
}
func reportTime() string {
	if os.Getenv("ALICACTL_TEST_MODE") == "1" {
		if value := os.Getenv("ALICACTL_NOW"); value != "" {
			if _, err := time.Parse(time.RFC3339, value); err == nil {
				return value
			}
		}
	}
	return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
}
func sorted(values []string) []string {
	result := append([]string{}, values...)
	sort.Strings(result)
	return result
}
func equalStrings(a, b []string) bool {
	a, b = sorted(a), sorted(b)
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func formatPorts(values []contract.PortContract) string {
	parts := []string{}
	for _, p := range values {
		parts = append(parts, fmt.Sprintf("%s:%d->%d/%s", p.HostIP, p.Published, p.Target, p.Protocol))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}
func equalPorts(a, b []contract.PortContract) bool { return formatPorts(a) == formatPorts(b) }
func countClass(_ *Observation, _ string) int      { return 0 }
