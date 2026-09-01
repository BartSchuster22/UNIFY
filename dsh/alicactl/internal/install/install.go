package install

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
)

//go:embed assets/*
var assets embed.FS

const maxRequestBytes = 64 * 1024

var requiredComponents = []string{"alica-runtime", "caddy", "herman-runtime", "keycloak", "memory-v4", "postgresql", "unify-core", "uniui"}
var minimumCellComponents = []string{"ainba-anchor", "doghouse-node"}

type ProviderConfig struct {
	Mode           string `json:"mode"`
	ProviderID     string `json:"providerId"`
	BaseURL        string `json:"baseUrl"`
	CredentialFile string `json:"credentialFile"`
}

type Request struct {
	SchemaVersion    string          `json:"schemaVersion"`
	CellID           string          `json:"cellId"`
	InstallationRoot string          `json:"installationRoot"`
	PublicHost       string          `json:"publicHost"`
	PublicOrigin     string          `json:"publicOrigin"`
	Project          string          `json:"project"`
	AdminUsername    string          `json:"adminUsername"`
	EULADigest       string          `json:"eulaDigest"`
	EULAAccepted     bool            `json:"eulaAccepted"`
	Provider         *ProviderConfig `json:"provider,omitempty"`
}

type Result struct {
	SchemaVersion  string   `json:"schemaVersion"`
	Mode           string   `json:"mode"`
	Status         string   `json:"status"`
	Changed        bool     `json:"changed"`
	CellID         string   `json:"cellId"`
	ReleaseID      string   `json:"releaseId"`
	ManifestDigest string   `json:"manifestDigest"`
	Components     []string `json:"components"`
	Mutation       bool     `json:"mutationPerformed"`
}

type Installer struct {
	Manifest       *contract.Manifest
	ManifestDigest string
	Request        Request
	DockerBin      string
	TestMode       bool
	FakeRuntime    bool
	operationID    string
	journal        lifecycle.OperationJournal
	lock           *os.File
	stage          string
	final          string
	mutated        bool
}

func LoadRequest(path string) (Request, error) {
	var request Request
	if err := contract.LoadClosedJSON(path, maxRequestBytes, &request); err != nil {
		return request, fmt.Errorf("installation request: %w", err)
	}
	return request, validateRequest(request)
}

func New(manifest *contract.Manifest, digest string, request Request) (*Installer, error) {
	if manifest == nil {
		return nil, errors.New("manifest is required")
	}
	if err := validateRequest(request); err != nil {
		return nil, err
	}
	if !manifest.Installable {
		return nil, errors.New("manifest is not installable")
	}
	if request.EULADigest != manifest.Product.EULADigest {
		return nil, errors.New("accepted EULA digest does not match manifest")
	}
	if isMinimumCellManifest(manifest) && request.Provider == nil {
		return nil, errors.New("minimum complete Cell requires a local BYOK provider configuration")
	}
	if !isMinimumCellManifest(manifest) && request.Provider != nil {
		return nil, errors.New("provider configuration is accepted only by a minimum complete Cell release")
	}
	images, err := componentImages(manifest)
	if err != nil {
		return nil, err
	}
	_ = images
	testMode := os.Getenv("ALICACTL_INSTALL_TEST_MODE") == "1"
	docker := "docker"
	if testMode {
		docker = os.Getenv("ALICACTL_DOCKER_BIN")
		if docker == "" {
			return nil, errors.New("test install mode requires ALICACTL_DOCKER_BIN")
		}
	}
	fakeRuntime := os.Getenv("ALICACTL_INSTALL_FAKE_RUNTIME") == "1"
	if fakeRuntime && !testMode {
		return nil, errors.New("fake runtime is permitted only in explicit install test mode")
	}
	return &Installer{Manifest: manifest, ManifestDigest: digest, Request: request, DockerBin: docker, TestMode: testMode, FakeRuntime: fakeRuntime}, nil
}

func isMinimumCellManifest(manifest *contract.Manifest) bool {
	for _, milestone := range []string{"-d3", "-d4", "-d5", "-d6"} {
		if strings.Contains(manifest.ReleaseVersion, milestone) {
			return true
		}
	}
	return false
}

func (i *Installer) runtimeComponents() []string {
	components := append([]string(nil), requiredComponents...)
	if i.Request.Provider != nil {
		components = append(components, minimumCellComponents...)
	}
	return components
}

func (i *Installer) Plan() (Result, error) {
	if err := i.preflight(false); err != nil {
		return Result{}, err
	}
	return i.result("plan", false), nil
}

func (i *Installer) Install() (result Result, err error) {
	if err = i.preflight(true); err != nil {
		return Result{}, err
	}
	if existing, ok := i.acceptedState(); ok {
		if existing.AcceptedCurrent.ReleaseID != i.Manifest.ReleaseID || existing.AcceptedCurrent.ManifestDigest != i.ManifestDigest || existing.CellID != i.Request.CellID {
			return Result{}, errors.New("a different Cell or release is already installed")
		}
		i.final = filepath.Join(i.Request.InstallationRoot, "release")
		i.stage = i.final
		if err := i.verifyRuntime(); err != nil {
			return Result{}, fmt.Errorf("installed Cell is not healthy: %w", err)
		}
		return i.result("install", false), nil
	}
	if err = i.acquireLock(); err != nil {
		return Result{}, err
	}
	defer i.releaseLock()
	if err = i.loadJournal(); err != nil {
		return Result{}, err
	}
	if err = i.recoverInterrupted(); err != nil {
		return Result{}, err
	}
	i.operationID, err = typedUUID7("op_")
	if err != nil {
		return Result{}, err
	}
	if err = i.appendPhase("planned", false, "pending"); err != nil {
		return Result{}, err
	}
	if err = i.appendPhase("preflight", false, "pending"); err != nil {
		return Result{}, err
	}
	defer func() {
		if err != nil {
			_ = i.rollback()
			_ = i.appendPhase("failed", i.mutated, "failed")
		}
	}()
	if err = i.stageRelease(); err != nil {
		return Result{}, err
	}
	if err = i.appendPhase("running", true, "pending"); err != nil {
		return Result{}, err
	}
	i.mutated = true
	if err = i.promoteRelease(); err != nil {
		return Result{}, err
	}
	if err = i.activate(); err != nil {
		return Result{}, err
	}
	if err = i.appendPhase("verify", true, "pending"); err != nil {
		return Result{}, err
	}
	if err = i.verifyRuntime(); err != nil {
		return Result{}, err
	}
	if err = i.recordPhase("accepted", true, "succeeded", false); err != nil {
		return Result{}, err
	}
	if err = i.commitState(); err != nil {
		return Result{}, err
	}
	return i.result("install", true), nil
}

func (i *Installer) preflight(forMutation bool) error {
	root := filepath.Clean(i.Request.InstallationRoot)
	if root == "/" || !filepath.IsAbs(root) || root != i.Request.InstallationRoot {
		return errors.New("installation root must be a clean absolute non-root path")
	}
	if !i.TestMode {
		if os.Geteuid() != 0 {
			return errors.New("clean installation requires root")
		}
		release, err := os.ReadFile("/etc/os-release")
		if err != nil || !bytes.Contains(release, []byte("ID=debian")) || !bytes.Contains(release, []byte("VERSION_ID=\"13\"")) {
			return errors.New("D2 supports Debian 13 only")
		}
		if runtime.GOARCH != "amd64" {
			return errors.New("D2 supports amd64 only")
		}
		if _, err := os.Stat("/run/systemd/system"); err != nil {
			return errors.New("D2 requires systemd as PID 1")
		}
		if len(i.Manifest.Platforms) != 1 {
			return errors.New("manifest must declare exactly one D2 platform")
		}
		minimum := i.Manifest.Platforms[0].Minimum
		if runtime.NumCPU() < minimum.VCPU {
			return fmt.Errorf("insufficient vCPU: have %d, require %d", runtime.NumCPU(), minimum.VCPU)
		}
		if memory := hostMemoryBytes(); memory < minimum.MemoryBytes {
			return fmt.Errorf("insufficient memory: have %d bytes, require %d", memory, minimum.MemoryBytes)
		}
		if disk := freeBytesFor(root); disk < minimum.FreeDiskBytes {
			return fmt.Errorf("insufficient free disk: have %d bytes, require %d", disk, minimum.FreeDiskBytes)
		}
	}
	if info, err := os.Stat(root); err == nil {
		if !info.IsDir() {
			return errors.New("installation root is not a directory")
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			return err
		}
		allowed := map[string]bool{"operation-journal.json": true, ".alicactl.lock": true, "failures": true, "accepted": true}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".release-staging-op_") || strings.HasPrefix(entry.Name(), ".accepted-staging-op_") {
				if !forMutation {
					return errors.New("interrupted installation requires recovery by alicactl install")
				}
				continue
			}
			if !allowed[entry.Name()] && entry.Name() != "cell-declaration.json" && entry.Name() != "lifecycle-state.json" && entry.Name() != "release" {
				return fmt.Errorf("installation root contains unmanaged entry %q", entry.Name())
			}
		}
		var state lifecycle.LifecycleState
		statePath := filepath.Join(root, "accepted", "lifecycle-state.json")
		if _, statErr := os.Stat(statePath); os.IsNotExist(statErr) {
			statePath = filepath.Join(root, "lifecycle-state.json") // D1 compatibility
		}
		if _, statErr := os.Stat(statePath); statErr == nil {
			if err := contract.LoadClosedJSON(statePath, 64*1024, &state); err != nil {
				return fmt.Errorf("existing lifecycle state: %w", err)
			}
			if err := lifecycle.ValidateState(&state); err != nil {
				return fmt.Errorf("existing lifecycle state: %w", err)
			}
		}
		var journal lifecycle.OperationJournal
		journalPath := filepath.Join(root, "accepted", "operation-journal.json")
		if _, statErr := os.Stat(journalPath); os.IsNotExist(statErr) {
			journalPath = filepath.Join(root, "operation-journal.json")
		}
		if _, statErr := os.Stat(journalPath); statErr == nil {
			if err := contract.LoadClosedJSON(journalPath, 8*1024*1024, &journal); err != nil {
				return fmt.Errorf("existing operation journal: %w", err)
			}
			if err := lifecycle.ValidateJournal(&journal); err != nil {
				return fmt.Errorf("existing operation journal: %w", err)
			}
			if !forMutation && len(journal.Entries) > 0 && !journalTerminal(journal.Entries[len(journal.Entries)-1].Phase) {
				return errors.New("interrupted operation journal requires recovery by alicactl install")
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if forMutation {
		if err := os.MkdirAll(root, 0o750); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, i.DockerBin, "version", "--format", "{{.Server.Version}}")
	output, dockerErr := cmd.CombinedOutput()
	if dockerErr != nil || strings.TrimSpace(string(output)) == "" {
		return fmt.Errorf("Docker server unavailable: %s", safeOutput(output))
	}
	if !i.TestMode {
		platform := i.Manifest.Platforms[0]
		if err := requireVersion("Docker", strings.TrimSpace(string(output)), platform.Docker.MinimumInclusive, platform.Docker.MaximumExclusive); err != nil {
			return err
		}
		compose := exec.CommandContext(ctx, i.DockerBin, "compose", "version", "--short")
		composeOutput, err := compose.CombinedOutput()
		if err != nil {
			return fmt.Errorf("Docker Compose unavailable: %s", safeOutput(composeOutput))
		}
		if err := requireVersion("Docker Compose", strings.TrimSpace(string(composeOutput)), platform.Compose.MinimumInclusive, platform.Compose.MaximumExclusive); err != nil {
			return err
		}
	}
	return nil
}

func (i *Installer) acquireLock() error {
	path := filepath.Join(i.Request.InstallationRoot, ".alicactl.lock")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return errors.New("another alicactl lifecycle operation holds the Cell lock")
	}
	if err = file.Truncate(0); err == nil {
		_, err = fmt.Fprintf(file, "%d\n", os.Getpid())
	}
	if err != nil {
		file.Close()
		return err
	}
	i.lock = file
	return nil
}

func (i *Installer) releaseLock() {
	if i.lock == nil {
		return
	}
	_ = syscall.Flock(int(i.lock.Fd()), syscall.LOCK_UN)
	_ = i.lock.Close()
	_ = os.Remove(filepath.Join(i.Request.InstallationRoot, ".alicactl.lock"))
}

func (i *Installer) stageRelease() error {
	i.stage = filepath.Join(i.Request.InstallationRoot, ".release-staging-"+i.operationID)
	i.final = filepath.Join(i.Request.InstallationRoot, "release")
	if _, err := os.Stat(i.final); err == nil {
		return errors.New("release directory exists without accepted state")
	}
	if err := os.RemoveAll(i.stage); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(i.stage, "secrets"), 0o700); err != nil {
		return err
	}
	compose, _ := assets.ReadFile("assets/compose.yaml")
	if err := writeAtomic(filepath.Join(i.stage, "compose.yaml"), compose, 0o640); err != nil {
		return err
	}
	images, _ := componentImages(i.Manifest)
	env := map[string]string{
		"ALICA_PROJECT": i.Request.Project, "ALICA_CELL_ID": i.Request.CellID, "ALICA_RELEASE_ID": i.Manifest.ReleaseID,
		"ALICA_PUBLIC_ORIGIN": i.Request.PublicOrigin, "KEYCLOAK_ADMIN_USERNAME": i.Request.AdminUsername, "BOOTSTRAP_ADMIN_USERNAME": i.Request.AdminUsername,
		"CADDY_IMAGE": images["caddy"], "UNIUI_IMAGE": images["uniui"], "UNIFY_CORE_IMAGE": images["unify-core"], "KEYCLOAK_IMAGE": images["keycloak"],
		"POSTGRESQL_IMAGE": images["postgresql"], "ALICA_RUNTIME_IMAGE": images["alica-runtime"], "HERMAN_RUNTIME_IMAGE": images["herman-runtime"], "MEMORY_V4_IMAGE": images["memory-v4"],
	}
	if i.Request.Provider != nil {
		env["AINBA_ANCHOR_IMAGE"] = images["ainba-anchor"]
		env["DOGHOUSE_NODE_IMAGE"] = images["doghouse-node"]
		for _, name := range []string{"ainba-anchor.mjs", "doghouse-node.mjs"} {
			content, err := assets.ReadFile("assets/" + name)
			if err != nil {
				return err
			}
			if err := writeAtomic(filepath.Join(i.stage, name), content, 0o444); err != nil {
				return err
			}
		}
		provider := map[string]string{"mode": i.Request.Provider.Mode, "providerId": i.Request.Provider.ProviderID, "baseUrl": i.Request.Provider.BaseURL, "credentialReference": "secret://cell/provider-api-key"}
		if err := writeJSONAtomic(filepath.Join(i.stage, "provider-config.json"), provider, 0o444); err != nil {
			return err
		}
	}
	if value := os.Getenv("ALICACTL_HTTP_PORT"); i.TestMode && value != "" {
		env["ALICA_HTTP_PORT"] = value
	}
	if value := os.Getenv("ALICACTL_HTTPS_PORT"); i.TestMode && value != "" {
		env["ALICA_HTTPS_PORT"] = value
	}
	if err := writeEnv(filepath.Join(i.stage, "compose.env"), env); err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(i.stage, "Caddyfile"), []byte(fmt.Sprintf("http://%s:8080 {\n  redir %s{uri} permanent\n}\nhttps://%s:8443 {\n  reverse_proxy uniui:3000\n}\n", i.Request.PublicHost, i.Request.PublicOrigin, i.Request.PublicHost)), 0o444); err != nil {
		return err
	}
	secrets, err := i.prepareSecrets()
	if err != nil {
		return err
	}
	initSQL := fmt.Sprintf("CREATE ROLE keycloak LOGIN PASSWORD '%s';\nCREATE DATABASE keycloak OWNER keycloak;\nCREATE ROLE unify_alica_adapter LOGIN PASSWORD '%s';\nCREATE ROLE unify_herman_adapter LOGIN PASSWORD '%s';\n", secrets["keycloak-database-password"], secrets["alica-database-password"], secrets["herman-database-password"])
	if err := writeAtomic(filepath.Join(i.stage, "postgres-init.sql"), []byte(initSQL), 0o444); err != nil {
		return err
	}
	if !i.FakeRuntime {
		if err := i.prepareTLS(); err != nil {
			return err
		}
	} else {
		for _, name := range []string{"framework-ca.crt", "framework-ca.key", "alica.crt", "alica.key", "herman.crt", "herman.key"} {
			if err := writeAtomic(filepath.Join(i.stage, "secrets", name), []byte("test-only\n"), 0o600); err != nil {
				return err
			}
		}
	}
	return syncDirectory(i.stage)
}

func (i *Installer) prepareSecrets() (map[string]string, error) {
	names := []string{"postgres-password", "keycloak-database-password", "keycloak-admin-password", "alica-database-password", "herman-database-password", "auth-pepper", "bootstrap-admin-password", "memory-v4-token", "alica-api-token", "herman-api-token", "alica-token", "herman-token"}
	if i.Request.Provider != nil {
		names = append(names, "ainba-control-token")
	}
	values := map[string]string{}
	for _, name := range names {
		value, err := randomSecret(36)
		if err != nil {
			return nil, err
		}
		values[name] = value
		if err := writeAtomic(filepath.Join(i.stage, "secrets", name), []byte(value+"\n"), 0o444); err != nil {
			return nil, err
		}
	}
	values["core-database-url"] = "postgresql://unify:" + values["postgres-password"] + "@postgresql:5432/unify"
	values["alica-database-url"] = "postgresql://unify_alica_adapter:" + values["alica-database-password"] + "@postgresql:5432/unify"
	values["herman-database-url"] = "postgresql://unify_herman_adapter:" + values["herman-database-password"] + "@postgresql:5432/unify"
	for _, name := range []string{"core-database-url", "alica-database-url", "herman-database-url"} {
		if err := writeAtomic(filepath.Join(i.stage, "secrets", name), []byte(values[name]+"\n"), 0o444); err != nil {
			return nil, err
		}
	}
	if i.Request.Provider != nil {
		credential, err := readProviderCredential(i.Request.Provider.CredentialFile, i.TestMode)
		if err != nil {
			return nil, err
		}
		values["provider-api-key"] = credential
		if err := writeAtomic(filepath.Join(i.stage, "secrets", "provider-api-key"), []byte(credential+"\n"), 0o444); err != nil {
			return nil, err
		}
	}
	for _, framework := range []string{"alica", "herman"} {
		bundle, _ := json.MarshalIndent(map[string]any{"active": map[string]string{"version": i.Manifest.ReleaseID, "token": values[framework+"-token"]}}, "", "  ")
		if err := writeAtomic(filepath.Join(i.stage, "secrets", framework+"-token-bundle.json"), append(bundle, '\n'), 0o444); err != nil {
			return nil, err
		}
	}
	return values, nil
}

func (i *Installer) prepareTLS() error {
	dir := filepath.Join(i.stage, "secrets")
	commands := [][]string{
		{"genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", filepath.Join(dir, "framework-ca.key")},
		{"req", "-x509", "-new", "-key", filepath.Join(dir, "framework-ca.key"), "-sha256", "-days", "3650", "-subj", "/CN=ALICA Framework CA", "-out", filepath.Join(dir, "framework-ca.crt")},
	}
	for _, args := range commands {
		if err := runCommand("openssl", args...); err != nil {
			return err
		}
	}
	for _, framework := range []string{"alica", "herman"} {
		key, csr, crt, ext := filepath.Join(dir, framework+".key"), filepath.Join(dir, framework+".csr"), filepath.Join(dir, framework+".crt"), filepath.Join(dir, framework+".ext")
		if err := runCommand("openssl", "req", "-newkey", "rsa:3072", "-nodes", "-subj", "/CN="+framework+"-adapter", "-keyout", key, "-out", csr); err != nil {
			return err
		}
		if err := os.WriteFile(ext, []byte("subjectAltName=DNS:"+framework+"-adapter\nextendedKeyUsage=serverAuth\n"), 0o600); err != nil {
			return err
		}
		if err := runCommand("openssl", "x509", "-req", "-in", csr, "-CA", filepath.Join(dir, "framework-ca.crt"), "-CAkey", filepath.Join(dir, "framework-ca.key"), "-CAcreateserial", "-days", "825", "-sha256", "-extfile", ext, "-out", crt); err != nil {
			return err
		}
		_ = os.Remove(csr)
		_ = os.Remove(ext)
	}
	for _, name := range []string{"framework-ca.crt", "framework-ca.key", "alica.crt", "alica.key", "herman.crt", "herman.key"} {
		if err := os.Chmod(filepath.Join(dir, name), 0o444); err != nil {
			return err
		}
	}
	return nil
}

func (i *Installer) activate() error {
	images, _ := componentImages(i.Manifest)
	keys := i.runtimeComponents()
	sort.Strings(keys)
	for _, key := range keys {
		if _, err := i.docker("image", "inspect", images[key], "--format", "{{.Id}}"); err != nil {
			if _, err = i.docker("pull", images[key]); err != nil {
				return fmt.Errorf("pull %s: %w", key, err)
			}
		}
	}
	if _, err := i.compose("config", "--quiet"); err != nil {
		return err
	}
	if _, err := i.compose("up", "-d", "--wait", "postgresql", "keycloak", "memory-v4"); err != nil {
		return err
	}
	if _, err := i.compose("--profile", "jobs", "run", "--rm", "migrate"); err != nil {
		return err
	}
	if _, err := i.compose("--profile", "jobs", "run", "--rm", "bootstrap-admin"); err != nil {
		return err
	}
	args := []string{"up", "-d", "--wait"}
	if i.Request.Provider != nil {
		args = append([]string{"--profile", "minimum-cell"}, args...)
	}
	if _, err := i.compose(args...); err != nil {
		return err
	}
	return nil
}

func (i *Installer) verifyRuntime() error {
	output, err := i.compose("ps", "--services", "--status", "running")
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, service := range strings.Fields(output) {
		seen[service] = true
	}
	services := []string{"alica", "caddy", "herman", "keycloak", "memory-v4", "postgresql", "unify-core", "uniui"}
	if i.Request.Provider != nil {
		services = append(services, "ainba-anchor", "doghouse-node")
	}
	for _, service := range services {
		if !seen[service] {
			return fmt.Errorf("required service %s is not running", service)
		}
	}
	return nil
}

func (i *Installer) promoteRelease() error {
	if i.stage == i.final {
		return nil
	}
	if err := os.Rename(i.stage, i.final); err != nil {
		return err
	}
	i.stage = i.final
	return syncDirectory(i.Request.InstallationRoot)
}

func (i *Installer) commitState() error {
	if i.stage != i.final {
		if err := i.promoteRelease(); err != nil {
			return err
		}
	}
	acceptedAt := time.Now().UTC().Format(time.RFC3339)
	declaration := lifecycle.CellDeclaration{SchemaVersion: "alica-cell-declaration/v1", CellID: i.Request.CellID, CreatedAt: acceptedAt, ProductID: i.Manifest.Product.ProductID, Profile: i.Manifest.Product.Profile, DeploymentMode: "single-host"}
	state := lifecycle.LifecycleState{SchemaVersion: "alica-lifecycle-state/v1", CellID: i.Request.CellID, Phase: "accepted", AcceptedCurrent: lifecycle.AcceptedCurrent{ReleaseID: i.Manifest.ReleaseID, ManifestDigest: i.ManifestDigest, Profile: i.Manifest.Product.Profile, AcceptedAt: acceptedAt}}
	staging := filepath.Join(i.Request.InstallationRoot, ".accepted-staging-"+i.operationID)
	accepted := filepath.Join(i.Request.InstallationRoot, "accepted")
	if err := os.RemoveAll(staging); err != nil {
		return err
	}
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return err
	}
	for name, value := range map[string]any{"cell-declaration.json": declaration, "lifecycle-state.json": state, "operation-journal.json": i.journal} {
		if err := writeJSONAtomic(filepath.Join(staging, name), value, 0o640); err != nil {
			return err
		}
	}
	if err := syncDirectory(staging); err != nil {
		return err
	}
	if err := os.Rename(staging, accepted); err != nil {
		return err
	}
	if err := syncDirectory(i.Request.InstallationRoot); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(i.Request.InstallationRoot, "operation-journal.json"))
	return nil
}

func (i *Installer) rollback() error {
	if i.stage != "" {
		if _, statErr := os.Stat(i.stage); os.IsNotExist(statErr) && i.final != "" {
			i.stage = i.final
		}
		_, _ = i.compose("down", "--volumes", "--remove-orphans")
		_ = removeTree(i.stage)
		if i.final != "" && i.final != i.stage {
			_ = removeTree(i.final)
		}
	}
	_ = os.Remove(filepath.Join(i.Request.InstallationRoot, "cell-declaration.json"))
	_ = os.Remove(filepath.Join(i.Request.InstallationRoot, "lifecycle-state.json"))
	_ = os.RemoveAll(filepath.Join(i.Request.InstallationRoot, ".accepted-staging-"+i.operationID))
	return nil
}

func (i *Installer) compose(args ...string) (string, error) {
	base := []string{"compose", "--env-file", filepath.Join(i.stage, "compose.env"), "-f", filepath.Join(i.stage, "compose.yaml"), "--project-name", i.Request.Project}
	return i.docker(append(base, args...)...)
}

func (i *Installer) docker(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, i.DockerBin, args...)
	cmd.Env = append(cleanDockerEnvironment(), "DOCKER_CLI_HINTS=false")
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return "", fmt.Errorf("Docker command timed out: %s", strings.Join(args, " "))
	}
	if err != nil {
		return "", fmt.Errorf("docker %s failed: %s", strings.Join(args, " "), safeOutput(output))
	}
	return strings.TrimSpace(string(output)), nil
}

func cleanDockerEnvironment() []string {
	blocked := map[string]bool{
		"ALICA_PROJECT": true, "ALICA_CELL_ID": true, "ALICA_RELEASE_ID": true,
		"ALICA_PUBLIC_ORIGIN": true, "ALICA_INSTALL_ROOT": true,
		"KEYCLOAK_ADMIN_USERNAME": true, "ALICACTL_HTTP_PORT": true, "ALICACTL_HTTPS_PORT": true,
		"CADDY_IMAGE": true, "UNIUI_IMAGE": true, "UNIFY_CORE_IMAGE": true,
		"KEYCLOAK_IMAGE": true, "POSTGRESQL_IMAGE": true, "ALICA_IMAGE": true,
		"ALICA_RUNTIME_IMAGE": true, "HERMAN_IMAGE": true, "HERMAN_RUNTIME_IMAGE": true,
		"MEMORY_V4_IMAGE": true,
	}
	clean := make([]string, 0, len(os.Environ()))
	for _, pair := range os.Environ() {
		name, _, _ := strings.Cut(pair, "=")
		if !blocked[name] {
			clean = append(clean, pair)
		}
	}
	return clean
}

func (i *Installer) loadJournal() error {
	path := filepath.Join(i.Request.InstallationRoot, "accepted", "operation-journal.json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		path = filepath.Join(i.Request.InstallationRoot, "operation-journal.json")
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		i.journal = lifecycle.OperationJournal{SchemaVersion: "alica-operation-journal/v1", Entries: []lifecycle.OperationJournalEntry{}}
		return nil
	}
	return contract.LoadClosedJSON(path, 8*1024*1024, &i.journal)
}

func (i *Installer) recoverInterrupted() error {
	entries, err := os.ReadDir(i.Request.InstallationRoot)
	if err != nil {
		return err
	}
	stale := []string{}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".release-staging-op_") || strings.HasPrefix(entry.Name(), ".accepted-staging-op_") {
			stale = append(stale, filepath.Join(i.Request.InstallationRoot, entry.Name()))
		}
	}
	final := filepath.Join(i.Request.InstallationRoot, "release")
	if _, err := os.Stat(final); err == nil {
		stale = append(stale, final)
	}
	if len(stale) == 0 && (len(i.journal.Entries) == 0 || journalTerminal(i.journal.Entries[len(i.journal.Entries)-1].Phase)) {
		return nil
	}
	if len(i.journal.Entries) == 0 {
		return errors.New("orphan installation staging exists without an operation journal")
	}
	last := i.journal.Entries[len(i.journal.Entries)-1]
	if journalTerminal(last.Phase) {
		if last.Phase != "failed" {
			return errors.New("orphan runtime exists after a terminal operation; manual evidence review required")
		}
		for _, path := range stale {
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".release-staging-") || strings.HasPrefix(base, ".accepted-staging-") {
				if !strings.HasSuffix(base, last.OperationID) {
					return errors.New("failed-operation staging does not belong to the terminal journal operation")
				}
			}
			i.stage = path
			if _, err := os.Stat(filepath.Join(path, "compose.yaml")); err == nil {
				_, _ = i.compose("down", "--volumes", "--remove-orphans")
			}
			if err := removeTree(path); err != nil {
				return err
			}
		}
		i.stage = ""
		return nil
	}
	i.operationID = last.OperationID
	for _, path := range stale {
		i.stage = path
		if _, err := os.Stat(filepath.Join(path, "compose.yaml")); err == nil {
			_, _ = i.compose("down", "--volumes", "--remove-orphans")
		}
		if err := removeTree(path); err != nil {
			return err
		}
	}
	authorized := last.Phase == "running" || last.Phase == "verify"
	if err := i.appendPhase("failed", authorized, "failed"); err != nil {
		return err
	}
	i.stage, i.final, i.operationID = "", "", ""
	i.mutated = false
	return nil
}

func journalTerminal(phase string) bool {
	return phase == "accepted" || phase == "failed" || phase == "held"
}

func (i *Installer) appendPhase(phase string, authorized bool, result string) error {
	return i.recordPhase(phase, authorized, result, true)
}

func (i *Installer) recordPhase(phase string, authorized bool, result string, persist bool) error {
	previous := strings.Repeat("0", 64)
	sequence := 1
	if len(i.journal.Entries) > 0 {
		previous = strings.TrimPrefix(i.journal.Entries[len(i.journal.Entries)-1].EntryDigest, "sha256:")
		sequence = i.journal.Entries[len(i.journal.Entries)-1].Sequence + 1
	}
	record := lifecycle.OperationJournalEntry{Sequence: int(sequence), OperationID: i.operationID, Kind: "install", Phase: phase, SourceReleaseID: "none", TargetReleaseID: i.Manifest.ReleaseID, TargetManifestDigest: i.ManifestDigest, MutationAuthorized: authorized, Result: result, OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), EvidenceDigests: []string{}, PreviousEntryDigest: "sha256:" + previous, EntryDigest: ""}
	raw, _ := json.Marshal(record)
	var generic any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	_ = decoder.Decode(&generic)
	canonical, err := contract.CanonicalJSON(generic)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	record.EntryDigest = "sha256:" + hex.EncodeToString(digest[:])
	i.journal.Entries = append(i.journal.Entries, record)
	if !persist {
		return nil
	}
	return writeJSONAtomic(filepath.Join(i.Request.InstallationRoot, "operation-journal.json"), i.journal, 0o640)
}

func (i *Installer) acceptedState() (lifecycle.LifecycleState, bool) {
	var state lifecycle.LifecycleState
	path := filepath.Join(i.Request.InstallationRoot, "accepted", "lifecycle-state.json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		path = filepath.Join(i.Request.InstallationRoot, "lifecycle-state.json")
	}
	if err := contract.LoadClosedJSON(path, 64*1024, &state); err != nil {
		return state, false
	}
	return state, state.AcceptedCurrent.ReleaseID != ""
}

func (i *Installer) result(mode string, changed bool) Result {
	return Result{SchemaVersion: "alica-install-result/v1", Mode: mode, Status: "PASS", Changed: changed, CellID: i.Request.CellID, ReleaseID: i.Manifest.ReleaseID, ManifestDigest: i.ManifestDigest, Components: i.runtimeComponents(), Mutation: changed}
}

func validateRequest(r Request) error {
	if r.SchemaVersion != "alica-clean-install/v1" || !r.EULAAccepted {
		return errors.New("invalid installation request schema or EULA acceptance")
	}
	if !validTypedUUID7(r.CellID, "ins_") {
		return errors.New("invalid Cell ID")
	}
	if r.PublicOrigin != "https://"+r.PublicHost {
		return errors.New("public origin must exactly match public host over HTTPS")
	}
	if r.PublicHost == "uniui.aquiero.com" || strings.HasSuffix(r.PublicHost, ".aquiero.com") {
		return errors.New("production-specific Aquiero origins are forbidden in DSH clean installation")
	}
	if r.Project == "" || strings.ContainsAny(r.Project, " ./") || r.AdminUsername == "" {
		return errors.New("invalid project or administrator username")
	}
	if r.Provider != nil {
		if r.Provider.Mode != "byok" || r.Provider.ProviderID == "" || len(r.Provider.ProviderID) > 63 || strings.ContainsAny(r.Provider.ProviderID, " /\\") {
			return errors.New("invalid local BYOK provider identity or mode")
		}
		parsed, err := url.Parse(r.Provider.BaseURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return errors.New("BYOK provider base URL must be an uncredentialed HTTPS origin/path")
		}
		if !filepath.IsAbs(r.Provider.CredentialFile) || filepath.Clean(r.Provider.CredentialFile) != r.Provider.CredentialFile {
			return errors.New("BYOK credential file must be a clean absolute path")
		}
	}
	return nil
}

func readProviderCredential(path string, testMode bool) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("BYOK credential file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("BYOK credential file must be regular and inaccessible to group/other")
	}
	if !testMode {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return "", errors.New("BYOK credential file must be owned by root")
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 || len(raw) > 16*1024 {
		return "", errors.New("BYOK credential file must contain 1..16384 bytes")
	}
	value := strings.TrimSpace(string(raw))
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return "", errors.New("BYOK credential must be one non-empty line")
	}
	return value, nil
}

func componentImages(manifest *contract.Manifest) (map[string]string, error) {
	images := map[string]string{}
	for _, component := range manifest.Components {
		images[component.ComponentID] = strings.TrimPrefix(component.Artifact, "oci://")
	}
	for _, required := range requiredComponents {
		if images[required] == "" {
			return nil, fmt.Errorf("manifest is missing required D2 component %s", required)
		}
	}
	for _, required := range minimumCellComponents {
		if images[required] == "" {
			return nil, fmt.Errorf("manifest is missing required D3 component %s", required)
		}
	}
	return images, nil
}

func writeEnv(path string, values map[string]string) error {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		if strings.ContainsAny(values[k], "\n\r") {
			return errors.New("environment value contains newline")
		}
		fmt.Fprintf(&b, "%s=%s\n", k, values[k])
	}
	return writeAtomic(path, []byte(b.String()), 0o600)
}
func writeJSONAtomic(path string, value any, mode os.FileMode) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(raw, '\n'), mode)
}
func writeAtomic(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	temp := path + ".tmp"
	f, err := os.OpenFile(temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err = f.Write(content); err == nil {
		err = f.Chmod(mode)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temp)
		return err
	}
	if err = os.Rename(temp, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
func syncDirectory(path string) error {
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func randomSecret(bytesCount int) (string, error) {
	value := make([]byte, bytesCount)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
func typedUUID7(prefix string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	millis := uint64(time.Now().UnixMilli())
	raw[0] = byte(millis >> 40)
	raw[1] = byte(millis >> 32)
	raw[2] = byte(millis >> 24)
	raw[3] = byte(millis >> 16)
	raw[4] = byte(millis >> 8)
	raw[5] = byte(millis)
	raw[6] = (raw[6] & 0x0f) | 0x70
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s%08x-%04x-%04x-%04x-%012x", prefix, raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}
func validTypedUUID7(value, prefix string) bool {
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	u := strings.TrimPrefix(value, prefix)
	if len(u) != 36 || u[8] != '-' || u[13] != '-' || u[18] != '-' || u[23] != '-' || u[14] != '7' || !strings.ContainsRune("89ab", rune(u[19])) {
		return false
	}
	for n, c := range u {
		if n == 8 || n == 13 || n == 18 || n == 23 {
			continue
		}
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}
func requireVersion(name, actual, minimum, maximum string) error {
	value, err := contract.ParseVersion(actual)
	if err != nil {
		return fmt.Errorf("%s version is invalid: %q", name, actual)
	}
	min, err := contract.ParseVersion(minimum)
	if err != nil {
		return err
	}
	max, err := contract.ParseVersion(maximum)
	if err != nil {
		return err
	}
	compare := func(a, b [3]int) int {
		for index := range a {
			if a[index] < b[index] {
				return -1
			}
			if a[index] > b[index] {
				return 1
			}
		}
		return 0
	}
	if compare(value, min) < 0 || compare(value, max) >= 0 {
		return fmt.Errorf("%s %s is outside supported range [%s,%s)", name, actual, minimum, maximum)
	}
	return nil
}

func hostMemoryBytes() int64 {
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		var kib int64
		if _, err := fmt.Sscanf(line, "MemTotal: %d kB", &kib); err == nil {
			return kib * 1024
		}
	}
	return 0
}

func freeBytesFor(path string) int64 {
	candidate := path
	for {
		if _, err := os.Stat(candidate); err == nil {
			break
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return 0
		}
		candidate = parent
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(candidate, &stat); err != nil {
		return 0
	}
	return int64(stat.Bavail) * int64(stat.Bsize)
}

func runCommand(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s failed: %s", name, safeOutput(out))
	}
	return nil
}
func removeTree(path string) error {
	_ = filepath.WalkDir(path, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr == nil && entry.IsDir() {
			_ = os.Chmod(current, 0o700)
		}
		return nil
	})
	return os.RemoveAll(path)
}

func safeOutput(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if len(text) > 4096 {
		text = text[:4096]
	}
	return text
}
