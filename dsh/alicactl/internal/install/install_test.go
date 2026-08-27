package install

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
)

func TestPlanIsReadOnlyAndInstallIsAtomicAndIdempotent(t *testing.T) {
	fixture := t.TempDir()
	root := filepath.Join(fixture, "cell")
	docker := fakeDocker(t, fixture, false)
	t.Setenv("ALICACTL_INSTALL_TEST_MODE", "1")
	t.Setenv("ALICACTL_INSTALL_FAKE_RUNTIME", "1")
	t.Setenv("ALICACTL_DOCKER_BIN", docker)
	installer, err := New(testManifest(), "sha256:"+strings.Repeat("a", 64), testRequest(root))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := installer.Plan()
	if err != nil {
		t.Fatal(err)
	}
	if plan.Mutation || plan.Changed {
		t.Fatalf("plan mutated: %+v", plan)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("plan created root: %v", err)
	}

	result, err := installer.Install()
	if err != nil {
		t.Fatal(err)
	}
	if !result.Changed || !result.Mutation {
		t.Fatalf("install result: %+v", result)
	}
	for _, name := range []string{"accepted/cell-declaration.json", "accepted/lifecycle-state.json", "accepted/operation-journal.json", "release/compose.yaml", "release/compose.env"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
	second, err := New(testManifest(), "sha256:"+strings.Repeat("a", 64), testRequest(root))
	if err != nil {
		t.Fatal(err)
	}
	result, err = second.Install()
	if err != nil {
		t.Fatal(err)
	}
	if result.Changed || result.Mutation {
		t.Fatalf("idempotent install mutated: %+v", result)
	}
}

func TestInstallFailureRollsBackRuntimeAndNeverAcceptsState(t *testing.T) {
	fixture := t.TempDir()
	root := filepath.Join(fixture, "cell")
	docker := fakeDocker(t, fixture, true)
	t.Setenv("ALICACTL_INSTALL_TEST_MODE", "1")
	t.Setenv("ALICACTL_INSTALL_FAKE_RUNTIME", "1")
	t.Setenv("ALICACTL_DOCKER_BIN", docker)
	installer, err := New(testManifest(), "sha256:"+strings.Repeat("b", 64), testRequest(root))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = installer.Install(); err == nil {
		t.Fatal("expected injected Docker failure")
	}
	if _, statErr := os.Stat(filepath.Join(root, "accepted", "lifecycle-state.json")); !os.IsNotExist(statErr) {
		t.Fatalf("failed install accepted state: %v", statErr)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".release-staging-") {
			t.Fatalf("staging survived: %s", entry.Name())
		}
	}
	log, err := os.ReadFile(filepath.Join(fixture, "docker.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "down --volumes --remove-orphans") {
		t.Fatalf("rollback missing: %s", log)
	}
}

func TestRequestRejectsProductionOrigin(t *testing.T) {
	request := testRequest("/var/lib/alica")
	request.PublicHost = "uniui.aquiero.com"
	request.PublicOrigin = "https://uniui.aquiero.com"
	if err := validateRequest(request); err == nil {
		t.Fatal("production origin accepted")
	}
}

func TestInstallRecoversInterruptedRunningOperationBeforeRetry(t *testing.T) {
	fixture := t.TempDir()
	root := filepath.Join(fixture, "cell")
	docker := fakeDocker(t, fixture, false)
	t.Setenv("ALICACTL_INSTALL_TEST_MODE", "1")
	t.Setenv("ALICACTL_INSTALL_FAKE_RUNTIME", "1")
	t.Setenv("ALICACTL_DOCKER_BIN", docker)
	interrupted, err := New(testManifest(), "sha256:"+strings.Repeat("c", 64), testRequest(root))
	if err != nil {
		t.Fatal(err)
	}
	if err := interrupted.preflight(true); err != nil {
		t.Fatal(err)
	}
	interrupted.operationID = "op_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b92"
	if err := interrupted.loadJournal(); err != nil {
		t.Fatal(err)
	}
	for _, phase := range []struct {
		name       string
		authorized bool
	}{{"planned", false}, {"preflight", false}} {
		if err := interrupted.appendPhase(phase.name, phase.authorized, "pending"); err != nil {
			t.Fatal(err)
		}
	}
	if err := interrupted.stageRelease(); err != nil {
		t.Fatal(err)
	}
	if err := interrupted.appendPhase("running", true, "pending"); err != nil {
		t.Fatal(err)
	}

	retry, err := New(testManifest(), "sha256:"+strings.Repeat("c", 64), testRequest(root))
	if err != nil {
		t.Fatal(err)
	}
	result, err := retry.Install()
	if err != nil {
		t.Fatal(err)
	}
	if !result.Changed {
		t.Fatalf("recovered retry did not install: %+v", result)
	}
	journalRaw, err := os.ReadFile(filepath.Join(root, "accepted", "operation-journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(journalRaw), `"phase": "failed"`) || !strings.Contains(string(journalRaw), `"phase": "accepted"`) {
		t.Fatalf("recovery journal missing failed/accepted phases: %s", journalRaw)
	}
}

func TestCleanDockerEnvironmentPreventsHostImageOverride(t *testing.T) {
	t.Setenv("KEYCLOAK_IMAGE", "attacker.invalid/keycloak:latest")
	for _, pair := range cleanDockerEnvironment() {
		if strings.HasPrefix(pair, "KEYCLOAK_IMAGE=") {
			t.Fatal("host image override survived Docker environment sanitization")
		}
	}
}

func TestWriteAtomicEnforcesRequestedModeAfterUmask(t *testing.T) {
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)
	path := filepath.Join(t.TempDir(), "Caddyfile")
	if err := writeAtomic(path, []byte("test\n"), 0o444); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o444 {
		t.Fatalf("mode = %04o, want 0444", info.Mode().Perm())
	}
}

func testManifest() *contract.Manifest {
	components := make([]contract.Component, 0, len(requiredComponents))
	for _, id := range requiredComponents {
		components = append(components, contract.Component{ComponentID: id, Artifact: "oci://registry.example/alica/" + id + "@sha256:" + strings.Repeat("1", 64)})
	}
	return &contract.Manifest{ReleaseID: "rel_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b90", Installable: true, Product: contract.ProductBinding{ProductID: "com.alica.community-dsh", Profile: "dsh-minimal/v1", EULADigest: "sha256:" + strings.Repeat("e", 64)}, Components: components}
}

func testRequest(root string) Request {
	return Request{SchemaVersion: "alica-clean-install/v1", CellID: "ins_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b91", InstallationRoot: root, PublicHost: "localhost", PublicOrigin: "https://localhost", Project: "alica-test", AdminUsername: "admin", EULADigest: "sha256:" + strings.Repeat("e", 64), EULAAccepted: true}
}

func fakeDocker(t *testing.T, fixture string, fail bool) string {
	t.Helper()
	path := filepath.Join(fixture, "docker")
	failure := "0"
	if fail {
		failure = "1"
	}
	script := `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "` + filepath.Join(fixture, "docker.log") + `"
if [ "$1" = version ]; then echo 28.4.0; exit 0; fi
if [ "$1" = image ] && [ "$2" = inspect ]; then echo sha256:` + strings.Repeat("1", 64) + `; exit 0; fi
if [ "` + failure + `" = 1 ] && [ "$1" = compose ] && printf '%s' "$*" | grep -q 'up -d --wait postgresql'; then echo injected >&2; exit 9; fi
if [ "$1" = compose ] && printf '%s' "$*" | grep -q 'ps --services --status running'; then
  printf '%s\n' alica caddy herman keycloak memory-v4 postgresql unify-core uniui
fi
exit 0
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}
