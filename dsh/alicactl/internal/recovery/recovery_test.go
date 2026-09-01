package recovery

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
)

const testCellID = "ins_0199a000-1000-7a11-8c21-4f5d6e7a8b94"
const testReleaseID = "rel_0199a000-1000-7a11-8c21-4f5d6e7a8b93"

func TestEncryptedOffHostBackupAndIsolatedRestore(t *testing.T) {
	fixture := t.TempDir()
	objects := filepath.Join(fixture, "s3")
	if err := os.MkdirAll(objects, 0o700); err != nil {
		t.Fatal(err)
	}
	s3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
			http.Error(w, "unsigned", 403)
			return
		}
		name := filepath.Base(r.URL.Path)
		target := filepath.Join(objects, name)
		switch r.Method {
		case http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			if err := os.WriteFile(target, body, 0o600); err != nil {
				t.Error(err)
			}
			w.WriteHeader(200)
		case http.MethodGet:
			raw, err := os.ReadFile(target)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(raw)
		default:
			http.Error(w, "method", 405)
		}
	}))
	defer s3.Close()
	root := filepath.Join(fixture, "cell")
	volumeRoot := filepath.Join(fixture, "volumes")
	request := testRecoveryRequest(t, fixture, root, s3.URL)
	docker := fakeRecoveryDocker(t, fixture, volumeRoot, request.Project)
	t.Setenv("ALICACTL_OPERATIONS_TEST_MODE", "1")
	t.Setenv("ALICACTL_DOCKER_BIN", docker)
	t.Setenv("ALICA_TEST_VOLUME_ROOT", volumeRoot)
	seedInstalledCell(t, root, volumeRoot, request.Project)
	manager, err := New(request)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := manager.Backup()
	if err != nil {
		t.Fatal(err)
	}
	if backup.Status != "PASS" || !backup.OffHostReplicated || backup.RPOSeconds < 0 || backup.Services != 10 {
		t.Fatalf("backup: %+v", backup)
	}
	for _, name := range []string{"alica-backup.service", "alica-backup.timer", "alica-canary.service", "alica-canary.timer"} {
		if _, err := os.Stat(filepath.Join(root, "operations", "systemd", name)); err != nil {
			t.Fatalf("operations unit %s absent: %v", name, err)
		}
	}
	if info, err := os.Stat(filepath.Join(root, "operations", "alicactl")); err != nil || info.Mode().Perm() != 0o500 {
		t.Fatalf("operations binary not installed securely: %v %v", info, err)
	}
	manifestObject := filepath.Join(objects, backup.BackupID+".manifest.json")
	encryptedObject := filepath.Join(objects, backup.BackupID+".abk")
	if _, err := os.Stat(manifestObject); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(encryptedObject)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "preserve-me") {
		t.Fatal("encrypted object leaked plaintext")
	}
	if err = os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(volumeRoot); err != nil {
		t.Fatal(err)
	}
	request.BackupID = backup.BackupID
	manager, err = New(request)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := manager.Restore()
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != "PASS" || restored.CellID != testCellID || restored.ReleaseID != testReleaseID || restored.RTOMilliseconds < 0 {
		t.Fatalf("restore: %+v", restored)
	}
	value, err := os.ReadFile(filepath.Join(volumeRoot, request.Project+"_alica-data", "state.txt"))
	if err != nil || string(value) != "preserve-me\n" {
		t.Fatalf("state not restored: %q %v", value, err)
	}
	var state lifecycle.LifecycleState
	raw, err = os.ReadFile(filepath.Join(root, "accepted", "lifecycle-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &state); err != nil || state.CellID != testCellID {
		t.Fatalf("identity not preserved: %+v %v", state, err)
	}
}

func TestOperationsChecksAndSyntheticWebhook(t *testing.T) {
	fixture := t.TempDir()
	root := filepath.Join(fixture, "cell")
	volumeRoot := filepath.Join(fixture, "volumes")
	canary := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer canary.Close()
	deliveries := 0
	webhook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { deliveries++; w.WriteHeader(204) }))
	defer webhook.Close()
	request := testRecoveryRequest(t, fixture, root, "http://s3.invalid")
	request.Operations.CanaryURL = canary.URL
	request.Operations.WebhookURL = webhook.URL
	docker := fakeRecoveryDocker(t, fixture, volumeRoot, request.Project)
	t.Setenv("ALICACTL_OPERATIONS_TEST_MODE", "1")
	t.Setenv("ALICACTL_DOCKER_BIN", docker)
	t.Setenv("ALICA_TEST_VOLUME_ROOT", volumeRoot)
	seedInstalledCell(t, root, volumeRoot, request.Project)
	last := BackupManifest{SchemaVersion: "alica-backup-manifest/v1", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err := writeJSON(filepath.Join(root, "operations", "last-backup.json"), last, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(request)
	if err != nil {
		t.Fatal(err)
	}
	report, err := manager.OperationsCheck(true)
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "ALERT" || !report.AlertDelivered || deliveries != 1 || len(report.Checks) != 6 {
		t.Fatalf("report: %+v deliveries=%d", report, deliveries)
	}
}

func TestBackupTamperIsRejected(t *testing.T) {
	fixture := t.TempDir()
	key := filepath.Join(fixture, "key")
	if err := os.WriteFile(key, []byte("0123456789abcdef0123456789abcdef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plain := filepath.Join(fixture, "plain")
	object := filepath.Join(fixture, "object")
	out := filepath.Join(fixture, "out")
	if err := os.WriteFile(plain, []byte("critical-state"), 0o600); err != nil {
		t.Fatal(err)
	}
	rawKey, _ := readSecretFile(key, true)
	if err := encryptFile(plain, object, rawKey); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(object)
	raw[len(raw)-1] ^= 1
	if err := os.WriteFile(object, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := decryptFile(object, out, rawKey); err == nil {
		t.Fatal("tampered backup decrypted")
	}
}

func testRecoveryRequest(t *testing.T, fixture, root, endpoint string) Request {
	t.Helper()
	paths := []string{filepath.Join(fixture, "backup-key"), filepath.Join(fixture, "access-key"), filepath.Join(fixture, "secret-key")}
	values := []string{"0123456789abcdef0123456789abcdef", "ALICAACCESSKEY123456", "alicasecretkey012345678901234567890"}
	for i, p := range paths {
		if err := os.WriteFile(p, []byte(values[i]+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return Request{SchemaVersion: "alica-recovery-operations/v1", CellID: testCellID, InstallationRoot: root, Project: "alica-d4-test", EncryptionKeyFile: paths[0], LocalRepository: filepath.Join(fixture, "repository"), S3: S3Config{Endpoint: endpoint, Region: "us-east-1", Bucket: "cell-backups", Prefix: "d4", AccessKeyFile: paths[1], SecretAccessKeyFile: paths[2]}, Operations: OperationsConfig{WebhookURL: "http://webhook.invalid", CanaryURL: "http://canary.invalid", BackupMaxAgeSeconds: 3600, MinimumFreeDiskBytes: 1, CertificateWarnSeconds: 60}}
}

func seedInstalledCell(t *testing.T, root, volumeRoot, project string) {
	t.Helper()
	state := lifecycle.LifecycleState{SchemaVersion: "alica-lifecycle-state/v1", CellID: testCellID, Phase: "accepted", AcceptedCurrent: lifecycle.AcceptedCurrent{ReleaseID: testReleaseID, ManifestDigest: "sha256:" + strings.Repeat("a", 64), Profile: "dsh-minimal/v1", AcceptedAt: "2026-09-01T12:00:00Z"}}
	if err := writeJSON(filepath.Join(root, "accepted", "lifecycle-state.json"), state, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "release"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"compose.yaml", "compose.env"} {
		if err := os.WriteFile(filepath.Join(root, "release", name), []byte("test\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "accepted", "identity.txt"), []byte("preserve-identity\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(volumeRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"postgresql-data", "memory-data", "memory-backups", "alica-data", "herman-data", "ainba-data", "doghouse-state", "caddy-data", "caddy-config"} {
		dir := filepath.Join(volumeRoot, project+"_"+name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "state.txt"), []byte("preserve-me\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func fakeRecoveryDocker(t *testing.T, fixture, volumeRoot, project string) string {
	t.Helper()
	path := filepath.Join(fixture, "docker")
	script := fmt.Sprintf(`#!/bin/sh
set -eu
if [ "$1" = volume ] && [ "$2" = ls ]; then
 for n in postgresql-data memory-data memory-backups alica-data herman-data ainba-data doghouse-state caddy-data caddy-config; do echo %s_$n; done
 exit 0
fi
if [ "$1" = volume ] && [ "$2" = inspect ]; then
 mkdir -p "$ALICA_TEST_VOLUME_ROOT/$3"
 echo "$ALICA_TEST_VOLUME_ROOT/$3"
 exit 0
fi
if [ "$1" = ps ]; then
 for n in ainba-anchor alica caddy doghouse-node herman keycloak memory-v4 postgresql unify-core uniui; do echo "%s|$n"; done
 exit 0
fi
if [ "$1" = compose ]; then
 case "$*" in *"ps --services --status running"*) printf '%%s\n' ainba-anchor alica caddy doghouse-node herman keycloak memory-v4 postgresql unify-core uniui;; esac
 exit 0
fi
exit 1
`, project, testReleaseID)
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}
