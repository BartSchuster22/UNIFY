package lifecycle

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
)

type HostFacts struct {
	OSID            string `json:"osId"`
	OSVersion       string `json:"osVersion"`
	Architecture    string `json:"architecture"`
	Init            string `json:"init"`
	VCPU            int    `json:"vcpu"`
	MemoryBytes     int64  `json:"memoryBytes"`
	FreeDiskBytes   int64  `json:"freeDiskBytes"`
	DockerVersion   string `json:"dockerVersion"`
	ComposeVersion  string `json:"composeVersion"`
	DockerAvailable bool   `json:"dockerAvailable"`
}

type LifecycleState struct {
	SchemaVersion   string          `json:"schemaVersion"`
	CellID          string          `json:"cellId"`
	Phase           string          `json:"phase"`
	AcceptedCurrent AcceptedCurrent `json:"acceptedCurrent"`
}

type AcceptedCurrent struct {
	ReleaseID      string `json:"releaseId"`
	ManifestDigest string `json:"manifestDigest"`
	Profile        string `json:"profile"`
	AcceptedAt     string `json:"acceptedAt"`
}

type CellDeclaration struct {
	SchemaVersion  string `json:"schemaVersion"`
	CellID         string `json:"cellId"`
	CreatedAt      string `json:"createdAt"`
	ProductID      string `json:"productId"`
	Profile        string `json:"profile"`
	DeploymentMode string `json:"deploymentMode"`
}

type OperationJournal struct {
	SchemaVersion string                  `json:"schemaVersion"`
	Entries       []OperationJournalEntry `json:"entries"`
}

type OperationJournalEntry struct {
	OperationID          string   `json:"operationId"`
	Sequence             int      `json:"sequence"`
	Kind                 string   `json:"kind"`
	OccurredAt           string   `json:"occurredAt"`
	SourceReleaseID      string   `json:"sourceReleaseId"`
	TargetReleaseID      string   `json:"targetReleaseId"`
	TargetManifestDigest string   `json:"targetManifestDigest"`
	Phase                string   `json:"phase"`
	Result               string   `json:"result"`
	MutationAuthorized   bool     `json:"mutationAuthorized"`
	EvidenceDigests      []string `json:"evidenceDigests"`
	PreviousEntryDigest  string   `json:"previousEntryDigest"`
	EntryDigest          string   `json:"entryDigest"`
}

type Observation struct {
	SchemaVersion string              `json:"schemaVersion"`
	Source        string              `json:"source"`
	Host          HostFacts           `json:"host"`
	State         *LifecycleState     `json:"state"`
	Declaration   *CellDeclaration    `json:"declaration"`
	Journal       *OperationJournal   `json:"journal"`
	Containers    []ObservedContainer `json:"containers"`
	Networks      []ObservedNetwork   `json:"networks"`
	Volumes       []ObservedVolume    `json:"volumes"`
	HostUnits     []ObservedHostUnit  `json:"hostUnits"`
}

type ObservedContainer struct {
	ComponentID    string                  `json:"componentId"`
	Name           string                  `json:"name"`
	ImageDigest    string                  `json:"imageDigest"`
	ReleaseID      string                  `json:"releaseId"`
	Managed        string                  `json:"managed"`
	State          string                  `json:"state"`
	Health         string                  `json:"health"`
	Networks       []string                `json:"networks"`
	Volumes        []string                `json:"volumes"`
	PublishedPorts []contract.PortContract `json:"publishedPorts"`
}

type ObservedNetwork struct {
	ID       string `json:"id"`
	Internal bool   `json:"internal"`
}
type ObservedVolume struct {
	ID        string `json:"id"`
	Authority string `json:"authority"`
}
type ObservedHostUnit struct {
	ComponentID string `json:"componentId"`
	Unit        string `json:"unit"`
	LoadState   string `json:"loadState"`
	ActiveState string `json:"activeState"`
}

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Code   string `json:"code"`
	Detail string `json:"detail"`
}
type Drift struct {
	Class    string `json:"class"`
	Resource string `json:"resource"`
	Expected string `json:"expected"`
	Observed string `json:"observed"`
}
type Report struct {
	SchemaVersion     string  `json:"schemaVersion"`
	Command           string  `json:"command"`
	GeneratedAt       string  `json:"generatedAt"`
	Status            string  `json:"status"`
	MutationPerformed bool    `json:"mutationPerformed"`
	ReleaseID         string  `json:"releaseId"`
	ManifestDigest    string  `json:"manifestDigest"`
	CellID            *string `json:"cellId"`
	Checks            []Check `json:"checks"`
	Drift             []Drift `json:"drift"`
	Summary           Summary `json:"summary"`
}
type Summary struct {
	Passed int `json:"passed"`
	Failed int `json:"failed"`
	Drift  int `json:"drift"`
}

func Observe(root string, manifest *contract.Manifest, fixturePath string) (*Observation, error) {
	if fixturePath != "" {
		if os.Getenv("ALICACTL_TEST_MODE") != "1" {
			return nil, errors.New("--observation is available only with ALICACTL_TEST_MODE=1")
		}
		var observation Observation
		if err := loadClosed(fixturePath, 2*1024*1024, &observation); err != nil {
			return nil, err
		}
		if observation.SchemaVersion != "alica-observed-state/v1" || observation.Source != "test-fixture" {
			return nil, errors.New("invalid test observation contract")
		}
		if observation.State != nil {
			if err := validateState(observation.State); err != nil {
				return nil, err
			}
		}
		if observation.Declaration != nil {
			if err := validateDeclaration(observation.Declaration); err != nil {
				return nil, err
			}
		}
		if observation.Journal != nil {
			if err := validateJournal(observation.Journal); err != nil {
				return nil, err
			}
		}
		return &observation, nil
	}
	host, err := inspectHost(root)
	if err != nil {
		return nil, err
	}
	observation := &Observation{SchemaVersion: "alica-observed-state/v1", Source: "live-read-only", Host: host, Containers: []ObservedContainer{}, Networks: []ObservedNetwork{}, Volumes: []ObservedVolume{}, HostUnits: []ObservedHostUnit{}}
	statePath := filepath.Join(root, "var/lib/alica/lifecycle-state.json")
	var state LifecycleState
	if err := loadClosed(statePath, 256*1024, &state); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return observation, nil
		}
		return nil, fmt.Errorf("lifecycle state: %w", err)
	}
	if err := validateState(&state); err != nil {
		return nil, err
	}
	observation.State = &state
	declarationPath := filepath.Join(root, "var/lib/alica/cell-declaration.json")
	var declaration CellDeclaration
	if err := loadClosed(declarationPath, 256*1024, &declaration); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("Cell declaration: %w", err)
		}
	} else {
		if err := validateDeclaration(&declaration); err != nil {
			return nil, err
		}
		observation.Declaration = &declaration
	}
	journalPath := filepath.Join(root, "var/lib/alica/operation-journal.json")
	var journal OperationJournal
	if err := loadClosed(journalPath, 2*1024*1024, &journal); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("operation journal: %w", err)
		}
	} else {
		if err := validateJournal(&journal); err != nil {
			return nil, err
		}
		observation.Journal = &journal
	}
	if !host.DockerAvailable {
		return observation, nil
	}
	if err := observeDocker(&state, manifest, observation); err != nil {
		return nil, err
	}
	for _, expected := range manifest.Topology.HostUnits {
		load, active := systemdState(expected.Unit)
		observation.HostUnits = append(observation.HostUnits, ObservedHostUnit{ComponentID: expected.ComponentID, Unit: expected.Unit, LoadState: load, ActiveState: active})
	}
	return observation, nil
}

func inspectHost(root string) (HostFacts, error) {
	facts := HostFacts{Architecture: runtime.GOARCH, VCPU: runtime.NumCPU(), DockerVersion: "unavailable", ComposeVersion: "unavailable"}
	osRelease, err := os.ReadFile(filepath.Join(root, "etc/os-release"))
	if err != nil {
		return facts, fmt.Errorf("read os-release: %w", err)
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(osRelease), "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			values[parts[0]] = strings.Trim(parts[1], `"`)
		}
	}
	facts.OSID, facts.OSVersion = values["ID"], values["VERSION_ID"]
	if _, err := os.Stat(filepath.Join(root, "run/systemd/system")); err == nil {
		facts.Init = "systemd"
	} else {
		facts.Init = "unknown"
	}
	if memory, err := os.ReadFile(filepath.Join(root, "proc/meminfo")); err == nil {
		for _, line := range strings.Split(string(memory), "\n") {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					kb, _ := strconv.ParseInt(fields[1], 10, 64)
					facts.MemoryBytes = kb * 1024
				}
			}
		}
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(root, &stat); err == nil {
		facts.FreeDiskBytes = int64(stat.Bavail) * int64(stat.Bsize)
	}
	if value, err := dockerOutput("version", "--format", "{{.Server.Version}}"); err == nil {
		facts.DockerAvailable = true
		facts.DockerVersion = strings.TrimSpace(value)
	}
	if value, err := dockerOutput("compose", "version", "--short"); err == nil {
		facts.ComposeVersion = strings.TrimSpace(value)
	}
	return facts, nil
}

func validateState(state *LifecycleState) error {
	if state.SchemaVersion != "alica-lifecycle-state/v1" {
		return errors.New("unsupported lifecycle state schema")
	}
	if !validTypedUUID7(state.CellID, "ins_") {
		return errors.New("invalid Cell ID")
	}
	if state.Phase != "accepted" {
		return errors.New("D1 reads only accepted lifecycle state")
	}
	if !validTypedUUID7(state.AcceptedCurrent.ReleaseID, "rel_") || !validDigest(state.AcceptedCurrent.ManifestDigest) || state.AcceptedCurrent.Profile == "" {
		return errors.New("acceptedCurrent is incomplete")
	}
	if _, err := time.Parse(time.RFC3339, state.AcceptedCurrent.AcceptedAt); err != nil {
		return errors.New("acceptedCurrent.acceptedAt is invalid")
	}
	return nil
}

func validateDeclaration(declaration *CellDeclaration) error {
	if declaration.SchemaVersion != "alica-cell-declaration/v1" || !validTypedUUID7(declaration.CellID, "ins_") {
		return errors.New("invalid Cell declaration identity")
	}
	if declaration.ProductID != "com.alica.community-dsh" || declaration.Profile != "dsh-minimal/v1" || declaration.DeploymentMode != "single-host" {
		return errors.New("invalid Cell declaration product/profile/topology")
	}
	if _, err := time.Parse(time.RFC3339, declaration.CreatedAt); err != nil {
		return errors.New("Cell declaration createdAt is invalid")
	}
	return nil
}

func validateJournal(journal *OperationJournal) error {
	if journal.SchemaVersion != "alica-operation-journal/v1" || len(journal.Entries) > 100000 {
		return errors.New("invalid operation journal contract")
	}
	previous := "sha256:" + strings.Repeat("0", 64)
	var lastTime time.Time
	activeOperation, activeKind, activeSource, activeTarget, activeManifest := "", "", "", "", ""
	lastPhase := ""
	terminal := true
	for index, entry := range journal.Entries {
		if entry.Sequence != index+1 || !validTypedUUID7(entry.OperationID, "op_") || !validTypedUUID7(entry.TargetReleaseID, "rel_") || (entry.SourceReleaseID != "none" && !validTypedUUID7(entry.SourceReleaseID, "rel_")) {
			return fmt.Errorf("operation journal entry %d identity/sequence invalid", index)
		}
		if !containsString([]string{"install", "update", "rollback", "restore", "self-update"}, entry.Kind) || !containsString([]string{"planned", "preflight", "running", "verify", "accepted", "failed", "held"}, entry.Phase) || !containsString([]string{"pending", "succeeded", "failed", "held"}, entry.Result) {
			return fmt.Errorf("operation journal entry %d state invalid", index)
		}
		occurredAt, err := time.Parse(time.RFC3339, entry.OccurredAt)
		if err != nil || (!lastTime.IsZero() && !occurredAt.After(lastTime)) {
			return fmt.Errorf("operation journal entry %d timestamp invalid", index)
		}
		lastTime = occurredAt
		if entry.OperationID != activeOperation {
			if !terminal || entry.Phase != "planned" {
				return fmt.Errorf("operation journal entry %d starts before prior operation is terminal", index)
			}
			activeOperation, activeKind, activeSource, activeTarget, activeManifest = entry.OperationID, entry.Kind, entry.SourceReleaseID, entry.TargetReleaseID, entry.TargetManifestDigest
			lastPhase, terminal = "", false
		} else if entry.Kind != activeKind || entry.SourceReleaseID != activeSource || entry.TargetReleaseID != activeTarget || entry.TargetManifestDigest != activeManifest {
			return fmt.Errorf("operation journal entry %d operation binding drift", index)
		}
		allowed := map[string][]string{
			"":          {"planned"},
			"planned":   {"preflight", "failed", "held"},
			"preflight": {"running", "failed", "held"},
			"running":   {"verify", "failed", "held"},
			"verify":    {"accepted", "failed", "held"},
		}
		if !containsString(allowed[lastPhase], entry.Phase) {
			return fmt.Errorf("operation journal entry %d phase transition invalid", index)
		}
		expectedResult := "pending"
		if entry.Phase == "accepted" {
			expectedResult = "succeeded"
		} else if entry.Phase == "failed" {
			expectedResult = "failed"
		} else if entry.Phase == "held" {
			expectedResult = "held"
		}
		if entry.Result != expectedResult || ((entry.Phase == "planned" || entry.Phase == "preflight") && entry.MutationAuthorized) || ((entry.Phase == "running" || entry.Phase == "verify" || entry.Phase == "accepted") && !entry.MutationAuthorized) {
			return fmt.Errorf("operation journal entry %d result/authorization invalid", index)
		}
		terminal = containsString([]string{"accepted", "failed", "held"}, entry.Phase)
		lastPhase = entry.Phase
		if entry.PreviousEntryDigest != previous || !validDigest(entry.TargetManifestDigest) || !validDigest(entry.EntryDigest) {
			return fmt.Errorf("operation journal entry %d digest chain invalid", index)
		}
		if len(entry.EvidenceDigests) > 128 {
			return fmt.Errorf("operation journal entry %d has too many evidence digests", index)
		}
		evidenceSet := map[string]bool{}
		for _, evidence := range entry.EvidenceDigests {
			if !validDigest(evidence) || evidenceSet[evidence] {
				return fmt.Errorf("operation journal entry %d evidence digest invalid", index)
			}
			evidenceSet[evidence] = true
		}
		copy := entry
		copy.EntryDigest = ""
		raw, _ := json.Marshal(copy)
		var generic any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&generic); err != nil {
			return err
		}
		canonical, err := contract.CanonicalJSON(generic)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(canonical)
		if entry.EntryDigest != fmt.Sprintf("sha256:%x", digest) {
			return fmt.Errorf("operation journal entry %d content digest invalid", index)
		}
		previous = entry.EntryDigest
	}
	return nil
}

func validDigest(value string) bool {
	if len(value) != 71 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	for _, character := range value[7:] {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
}

func validTypedUUID7(value, prefix string) bool {
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	uuid := strings.TrimPrefix(value, prefix)
	if len(uuid) != 36 || uuid[8] != '-' || uuid[13] != '-' || uuid[18] != '-' || uuid[23] != '-' || uuid[14] != '7' || !strings.ContainsRune("89ab", rune(uuid[19])) {
		return false
	}
	for index, character := range uuid {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func observeDocker(state *LifecycleState, manifest *contract.Manifest, observation *Observation) error {
	idsRaw, err := dockerOutput("ps", "-aq", "--filter", "label=com.alica.cell.id="+state.CellID)
	if err != nil {
		return fmt.Errorf("docker container inventory: %w", err)
	}
	ids := strings.Fields(idsRaw)
	if len(ids) > 0 {
		args := append([]string{"inspect"}, ids...)
		raw, err := dockerOutput(args...)
		if err != nil {
			return err
		}
		var records []dockerContainer
		if err := json.Unmarshal([]byte(raw), &records); err != nil {
			return err
		}
		imageDigests, err := inspectImageDigests(records, manifest)
		if err != nil {
			return err
		}
		for _, record := range records {
			observation.Containers = append(observation.Containers, convertContainer(record, imageDigests[record.Image]))
		}
	}
	networkIDs, err := dockerOutput("network", "ls", "-q", "--filter", "label=com.alica.cell.id="+state.CellID)
	if err != nil {
		return err
	}
	if fields := strings.Fields(networkIDs); len(fields) > 0 {
		args := append([]string{"network", "inspect"}, fields...)
		raw, err := dockerOutput(args...)
		if err != nil {
			return err
		}
		var records []dockerNetwork
		if err := json.Unmarshal([]byte(raw), &records); err != nil {
			return err
		}
		for _, r := range records {
			observation.Networks = append(observation.Networks, ObservedNetwork{ID: r.Labels["com.alica.network.id"], Internal: r.Internal})
		}
	}
	volumeIDs, err := dockerOutput("volume", "ls", "-q", "--filter", "label=com.alica.cell.id="+state.CellID)
	if err != nil {
		return err
	}
	if fields := strings.Fields(volumeIDs); len(fields) > 0 {
		args := append([]string{"volume", "inspect"}, fields...)
		raw, err := dockerOutput(args...)
		if err != nil {
			return err
		}
		var records []dockerVolume
		if err := json.Unmarshal([]byte(raw), &records); err != nil {
			return err
		}
		for _, r := range records {
			observation.Volumes = append(observation.Volumes, ObservedVolume{ID: r.Labels["com.alica.volume.id"], Authority: r.Labels["com.alica.authority"]})
		}
	}
	sort.Slice(observation.Containers, func(i, j int) bool {
		return observation.Containers[i].ComponentID < observation.Containers[j].ComponentID
	})
	sort.Slice(observation.Networks, func(i, j int) bool { return observation.Networks[i].ID < observation.Networks[j].ID })
	sort.Slice(observation.Volumes, func(i, j int) bool { return observation.Volumes[i].ID < observation.Volumes[j].ID })
	return nil
}

type dockerContainer struct {
	Name   string `json:"Name"`
	Image  string `json:"Image"`
	Config struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Status string `json:"Status"`
		Health *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	NetworkSettings struct {
		Networks map[string]any `json:"Networks"`
		Ports    map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"Ports"`
	} `json:"NetworkSettings"`
	Mounts []struct {
		Name        string `json:"Name"`
		Type        string `json:"Type"`
		Destination string `json:"Destination"`
	} `json:"Mounts"`
}
type dockerNetwork struct {
	Internal bool              `json:"Internal"`
	Labels   map[string]string `json:"Labels"`
}
type dockerVolume struct {
	Labels map[string]string `json:"Labels"`
}
type dockerImage struct {
	ID          string   `json:"Id"`
	RepoDigests []string `json:"RepoDigests"`
}

func inspectImageDigests(containers []dockerContainer, manifest *contract.Manifest) (map[string]string, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, container := range containers {
		if !seen[container.Image] {
			seen[container.Image] = true
			ids = append(ids, container.Image)
		}
	}
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	raw, err := dockerOutput(append([]string{"image", "inspect"}, ids...)...)
	if err != nil {
		return nil, fmt.Errorf("docker image inventory: %w", err)
	}
	var images []dockerImage
	if err := json.Unmarshal([]byte(raw), &images); err != nil {
		return nil, err
	}
	expectedRepositories := map[string]string{}
	for _, component := range manifest.Components {
		if component.Realization == "oci-container" {
			withoutScheme := strings.TrimPrefix(component.Artifact, "oci://")
			expectedRepositories[component.ComponentID] = strings.SplitN(withoutScheme, "@", 2)[0]
		}
	}
	result := map[string]string{}
	for _, image := range images {
		for _, container := range containers {
			if container.Image != image.ID {
				continue
			}
			repository := expectedRepositories[container.Config.Labels["com.alica.component.id"]]
			for _, repoDigest := range image.RepoDigests {
				parts := strings.SplitN(repoDigest, "@", 2)
				if len(parts) == 2 && parts[0] == repository {
					result[image.ID] = parts[1]
					break
				}
			}
		}
	}
	return result, nil
}

func convertContainer(record dockerContainer, imageDigest string) ObservedContainer {
	labels := record.Config.Labels
	health := "none"
	if record.State.Health != nil {
		health = record.State.Health.Status
	}
	result := ObservedContainer{ComponentID: labels["com.alica.component.id"], Name: strings.TrimPrefix(record.Name, "/"), ImageDigest: imageDigest, ReleaseID: labels["com.alica.release.id"], Managed: labels["com.alica.managed"], State: record.State.Status, Health: health, Networks: []string{}, Volumes: []string{}, PublishedPorts: []contract.PortContract{}}
	for name := range record.NetworkSettings.Networks {
		result.Networks = append(result.Networks, trimResourcePrefix(name))
	}
	for _, mount := range record.Mounts {
		if mount.Type == "volume" {
			result.Volumes = append(result.Volumes, trimResourcePrefix(mount.Name))
		}
	}
	for target, bindings := range record.NetworkSettings.Ports {
		parts := strings.Split(target, "/")
		targetPort, _ := strconv.Atoi(parts[0])
		protocol := "tcp"
		if len(parts) == 2 {
			protocol = parts[1]
		}
		for _, binding := range bindings {
			published, _ := strconv.Atoi(binding.HostPort)
			result.PublishedPorts = append(result.PublishedPorts, contract.PortContract{HostIP: binding.HostIP, Published: published, Target: targetPort, Protocol: protocol})
		}
	}
	sort.Strings(result.Networks)
	sort.Strings(result.Volumes)
	sort.Slice(result.PublishedPorts, func(i, j int) bool { return result.PublishedPorts[i].Published < result.PublishedPorts[j].Published })
	return result
}

func trimResourcePrefix(value string) string { return strings.TrimPrefix(value, "alica_") }
func dockerOutput(args ...string) (string, error) {
	binary := os.Getenv("ALICACTL_DOCKER_BIN")
	if binary == "" {
		binary = "docker"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Env = append(os.Environ(), "LC_ALL=C")
	output, err := command.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("%s %s timed out", binary, strings.Join(args, " "))
	}
	if err != nil {
		return "", fmt.Errorf("%s %s: %w: %s", binary, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
func systemdState(unit string) (string, string) {
	load := systemdProperty(unit, "LoadState")
	active := systemdProperty(unit, "ActiveState")
	return load, active
}

func systemdProperty(unit, property string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "systemctl", "show", unit, "--property="+property, "--value").Output()
	if err != nil || ctx.Err() == context.DeadlineExceeded {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}
func loadClosed(path string, max int64, destination any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > max {
		return errors.New("input must be a bounded regular file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := contract.ValidateStrictJSON(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if decoder.Decode(&trailing) == nil {
		return errors.New("trailing JSON value")
	}
	return nil
}
