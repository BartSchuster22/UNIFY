package recovery

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
)

const maxRequestBytes = 64 * 1024
const chunkSize = 64 * 1024

var expectedServices = []string{"ainba-anchor", "alica", "caddy", "doghouse-node", "herman", "keycloak", "memory-v4", "postgresql", "unify-core", "uniui"}

type S3Config struct {
	Endpoint            string `json:"endpoint"`
	Region              string `json:"region"`
	Bucket              string `json:"bucket"`
	Prefix              string `json:"prefix"`
	AccessKeyFile       string `json:"accessKeyFile"`
	SecretAccessKeyFile string `json:"secretAccessKeyFile"`
}

type OperationsConfig struct {
	WebhookURL             string `json:"webhookUrl"`
	CanaryURL              string `json:"canaryUrl"`
	BackupMaxAgeSeconds    int64  `json:"backupMaxAgeSeconds"`
	MinimumFreeDiskBytes   int64  `json:"minimumFreeDiskBytes"`
	CertificateWarnSeconds int64  `json:"certificateWarnSeconds"`
}

type Request struct {
	SchemaVersion     string           `json:"schemaVersion"`
	CellID            string           `json:"cellId"`
	InstallationRoot  string           `json:"installationRoot"`
	Project           string           `json:"project"`
	EncryptionKeyFile string           `json:"encryptionKeyFile"`
	LocalRepository   string           `json:"localRepository"`
	S3                S3Config         `json:"s3"`
	Operations        OperationsConfig `json:"operations"`
	BackupID          string           `json:"backupId,omitempty"`
}

type DataUnit struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Digest string `json:"digest"`
	Bytes  int64  `json:"bytes"`
}

type BackupManifest struct {
	SchemaVersion         string     `json:"schemaVersion"`
	BackupID              string     `json:"backupId"`
	CellID                string     `json:"cellId"`
	ReleaseID             string     `json:"releaseId"`
	ReleaseManifestDigest string     `json:"releaseManifestDigest"`
	CreatedAt             string     `json:"createdAt"`
	Consistency           string     `json:"consistency"`
	Encryption            string     `json:"encryption"`
	ArchiveDigest         string     `json:"archiveDigest"`
	EncryptedObjectDigest string     `json:"encryptedObjectDigest"`
	EncryptedBytes        int64      `json:"encryptedBytes"`
	DataUnits             []DataUnit `json:"dataUnits"`
	RPOSeconds            int64      `json:"rpoSeconds"`
	QuiesceMilliseconds   int64      `json:"quiesceMilliseconds"`
	ManifestMAC           string     `json:"manifestMac"`
}

type Result struct {
	SchemaVersion     string `json:"schemaVersion"`
	Mode              string `json:"mode"`
	Status            string `json:"status"`
	Changed           bool   `json:"changed"`
	BackupID          string `json:"backupId,omitempty"`
	CellID            string `json:"cellId"`
	ReleaseID         string `json:"releaseId"`
	ManifestDigest    string `json:"manifestDigest,omitempty"`
	ObjectDigest      string `json:"objectDigest,omitempty"`
	Bytes             int64  `json:"bytes,omitempty"`
	RPOSeconds        int64  `json:"rpoSeconds,omitempty"`
	RTOMilliseconds   int64  `json:"rtoMilliseconds,omitempty"`
	Services          int    `json:"services,omitempty"`
	OffHostReplicated bool   `json:"offHostReplicated,omitempty"`
}

type Check struct{ Name, Status, Detail string }
type OperationsReport struct {
	SchemaVersion  string  `json:"schemaVersion"`
	Status         string  `json:"status"`
	CellID         string  `json:"cellId"`
	ReleaseID      string  `json:"releaseId"`
	CheckedAt      string  `json:"checkedAt"`
	Checks         []Check `json:"checks"`
	AlertDelivered bool    `json:"alertDelivered"`
	SyntheticAlert bool    `json:"syntheticAlert"`
}

type Manager struct {
	Request   Request
	DockerBin string
	TestMode  bool
}

func LoadRequest(path string) (Request, error) {
	var r Request
	if err := contract.LoadClosedJSON(path, maxRequestBytes, &r); err != nil {
		return r, fmt.Errorf("recovery request: %w", err)
	}
	if err := validateRequest(r); err != nil {
		return r, err
	}
	return r, nil
}

func New(r Request) (*Manager, error) {
	if err := validateRequest(r); err != nil {
		return nil, err
	}
	test := os.Getenv("ALICACTL_OPERATIONS_TEST_MODE") == "1"
	docker := "docker"
	if test {
		docker = os.Getenv("ALICACTL_DOCKER_BIN")
		if docker == "" {
			return nil, errors.New("operations test mode requires ALICACTL_DOCKER_BIN")
		}
	}
	return &Manager{Request: r, DockerBin: docker, TestMode: test}, nil
}

func validateRequest(r Request) error {
	if r.SchemaVersion != "alica-recovery-operations/v1" {
		return errors.New("unsupported recovery request schema")
	}
	if !validTypedID(r.CellID, "ins_") {
		return errors.New("invalid Cell ID")
	}
	for name, value := range map[string]string{"installationRoot": r.InstallationRoot, "encryptionKeyFile": r.EncryptionKeyFile, "localRepository": r.LocalRepository, "accessKeyFile": r.S3.AccessKeyFile, "secretAccessKeyFile": r.S3.SecretAccessKeyFile} {
		if !filepath.IsAbs(value) || filepath.Clean(value) != value {
			return fmt.Errorf("%s must be a clean absolute path", name)
		}
	}
	if r.InstallationRoot == "/" || pathWithin(r.LocalRepository, r.InstallationRoot) {
		return errors.New("backup repository must be off the Cell installation tree")
	}
	if r.Project == "" || strings.ContainsAny(r.Project, " ./\\") {
		return errors.New("invalid project")
	}
	u, err := url.Parse(r.S3.Endpoint)
	if err != nil || (u.Scheme != "https" && !(os.Getenv("ALICACTL_OPERATIONS_TEST_MODE") == "1" && u.Scheme == "http")) || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("S3 endpoint must be an uncredentialed HTTPS origin")
	}
	if r.S3.Region == "" || r.S3.Bucket == "" || strings.ContainsAny(r.S3.Bucket, "/\\ ") || strings.Contains(r.S3.Prefix, "..") {
		return errors.New("invalid S3 target")
	}
	if r.Operations.BackupMaxAgeSeconds < 60 || r.Operations.MinimumFreeDiskBytes < 1 || r.Operations.CertificateWarnSeconds < 60 {
		return errors.New("invalid operations thresholds")
	}
	for _, raw := range []string{r.Operations.WebhookURL, r.Operations.CanaryURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			if !(os.Getenv("ALICACTL_OPERATIONS_TEST_MODE") == "1" && e == nil && u.Scheme == "http" && u.Host != "") {
				return errors.New("operations URLs must be uncredentialed HTTPS URLs")
			}
		}
	}
	if r.BackupID != "" && !validTypedID(r.BackupID, "bak_") {
		return errors.New("invalid backup ID")
	}
	return nil
}

func (m *Manager) Backup() (result Result, err error) {
	state, err := m.acceptedState()
	if err != nil {
		return result, err
	}
	if err = m.acquireKeyFiles(); err != nil {
		return result, err
	}
	if err = os.MkdirAll(m.Request.LocalRepository, 0o700); err != nil {
		return result, err
	}
	backupID, err := typedUUID7("bak_")
	if err != nil {
		return result, err
	}
	started := time.Now()
	stopped := false
	if _, err = m.compose("stop", "--timeout", "60"); err != nil {
		return result, err
	}
	stopped = true
	defer func() {
		if stopped {
			_, startErr := m.compose("--profile", "minimum-cell", "up", "-d", "--wait")
			if err == nil && startErr != nil {
				err = startErr
			}
		}
	}()
	plain, err := os.CreateTemp(m.Request.LocalRepository, ".backup-*.tar")
	if err != nil {
		return result, err
	}
	plainPath := plain.Name()
	_ = plain.Close()
	defer os.Remove(plainPath)
	units, err := m.writeArchive(plainPath)
	if err != nil {
		return result, err
	}
	archiveDigest, _, err := fileDigest(plainPath)
	if err != nil {
		return result, err
	}
	objectPath := filepath.Join(m.Request.LocalRepository, backupID+".abk")
	key, err := readSecretFile(m.Request.EncryptionKeyFile, m.TestMode)
	if err != nil {
		return result, err
	}
	if err = encryptFile(plainPath, objectPath, key); err != nil {
		return result, err
	}
	objectDigest, objectBytes, err := fileDigest(objectPath)
	if err != nil {
		return result, err
	}
	rpo := m.backupAge()
	if rpo < 0 {
		rpo = 0
	}
	manifest := BackupManifest{SchemaVersion: "alica-backup-manifest/v1", BackupID: backupID, CellID: m.Request.CellID, ReleaseID: state.AcceptedCurrent.ReleaseID, ReleaseManifestDigest: state.AcceptedCurrent.ManifestDigest, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Consistency: "coordinated-cold", Encryption: "aes-256-gcm-chunked/v1", ArchiveDigest: archiveDigest, EncryptedObjectDigest: objectDigest, EncryptedBytes: objectBytes, DataUnits: units, RPOSeconds: rpo, QuiesceMilliseconds: time.Since(started).Milliseconds()}
	manifest.ManifestMAC = manifestMAC(manifest, key)
	manifestPath := filepath.Join(m.Request.LocalRepository, backupID+".manifest.json")
	if err = writeJSON(manifestPath, manifest, 0o600); err != nil {
		return result, err
	}
	if err = m.s3Put(backupID+".abk", objectPath, "application/octet-stream"); err != nil {
		return result, err
	}
	if err = m.s3Put(backupID+".manifest.json", manifestPath, "application/json"); err != nil {
		return result, err
	}
	if err = writeJSON(filepath.Join(m.Request.InstallationRoot, "operations", "last-backup.json"), manifest, 0o600); err != nil {
		return result, err
	}
	if err = m.installOperations(); err != nil {
		return result, err
	}
	if _, err = m.compose("--profile", "minimum-cell", "up", "-d", "--wait"); err != nil {
		return result, err
	}
	stopped = false
	return Result{SchemaVersion: "alica-recovery-result/v1", Mode: "backup", Status: "PASS", Changed: true, BackupID: backupID, CellID: m.Request.CellID, ReleaseID: state.AcceptedCurrent.ReleaseID, ManifestDigest: manifest.ReleaseManifestDigest, ObjectDigest: objectDigest, Bytes: objectBytes, RPOSeconds: manifest.RPOSeconds, Services: len(expectedServices), OffHostReplicated: true}, nil
}

func (m *Manager) Restore() (Result, error) {
	if m.Request.BackupID == "" {
		return Result{}, errors.New("restore requires backupId")
	}
	if entries, err := os.ReadDir(m.Request.InstallationRoot); err == nil && len(entries) > 0 {
		return Result{}, errors.New("restore target must be empty")
	} else if err != nil && !os.IsNotExist(err) {
		return Result{}, err
	}
	if err := m.acquireKeyFiles(); err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(m.Request.LocalRepository, 0o700); err != nil {
		return Result{}, err
	}
	manifestPath := filepath.Join(m.Request.LocalRepository, m.Request.BackupID+".manifest.json")
	objectPath := filepath.Join(m.Request.LocalRepository, m.Request.BackupID+".abk")
	if err := m.s3Get(m.Request.BackupID+".manifest.json", manifestPath); err != nil {
		return Result{}, err
	}
	if err := m.s3Get(m.Request.BackupID+".abk", objectPath); err != nil {
		return Result{}, err
	}
	var manifest BackupManifest
	if err := contract.LoadClosedJSON(manifestPath, 1024*1024, &manifest); err != nil {
		return Result{}, err
	}
	key, err := readSecretFile(m.Request.EncryptionKeyFile, m.TestMode)
	if err != nil {
		return Result{}, err
	}
	if manifest.SchemaVersion != "alica-backup-manifest/v1" || manifest.BackupID != m.Request.BackupID || manifest.CellID != m.Request.CellID || !hmac.Equal([]byte(manifest.ManifestMAC), []byte(manifestMAC(manifest, key))) {
		return Result{}, errors.New("backup manifest identity or MAC rejected")
	}
	digest, _, err := fileDigest(objectPath)
	if err != nil || digest != manifest.EncryptedObjectDigest {
		return Result{}, errors.New("encrypted backup object digest mismatch")
	}
	plain, err := os.CreateTemp(m.Request.LocalRepository, ".restore-*.tar")
	if err != nil {
		return Result{}, err
	}
	plainPath := plain.Name()
	_ = plain.Close()
	defer os.Remove(plainPath)
	if err = decryptFile(objectPath, plainPath, key); err != nil {
		return Result{}, err
	}
	digest, _, err = fileDigest(plainPath)
	if err != nil || digest != manifest.ArchiveDigest {
		return Result{}, errors.New("decrypted archive digest mismatch")
	}
	started := time.Now()
	if err = m.extractCell(plainPath); err != nil {
		return Result{}, err
	}
	state, err := m.acceptedState()
	if err != nil || state.AcceptedCurrent.ReleaseID != manifest.ReleaseID || state.AcceptedCurrent.ManifestDigest != manifest.ReleaseManifestDigest {
		return Result{}, errors.New("restored accepted identity mismatch")
	}
	if err = writeJSON(filepath.Join(m.Request.InstallationRoot, "operations", "last-backup.json"), manifest, 0o600); err != nil {
		return Result{}, err
	}
	if err = m.installOperations(); err != nil {
		return Result{}, err
	}
	if _, err = m.compose("--profile", "minimum-cell", "create"); err != nil {
		return Result{}, err
	}
	if err = m.extractVolumes(plainPath); err != nil {
		return Result{}, err
	}
	if _, err = m.compose("--profile", "minimum-cell", "up", "-d", "--wait"); err != nil {
		return Result{}, err
	}
	if err = m.verifyServices(); err != nil {
		return Result{}, err
	}
	return Result{SchemaVersion: "alica-recovery-result/v1", Mode: "restore", Status: "PASS", Changed: true, BackupID: manifest.BackupID, CellID: manifest.CellID, ReleaseID: manifest.ReleaseID, ManifestDigest: manifest.ReleaseManifestDigest, ObjectDigest: manifest.EncryptedObjectDigest, Bytes: manifest.EncryptedBytes, RTOMilliseconds: time.Since(started).Milliseconds(), Services: len(expectedServices), OffHostReplicated: true}, nil
}

func (m *Manager) Restart() (Result, error) {
	state, err := m.acceptedState()
	if err != nil {
		return Result{}, err
	}
	started := time.Now()
	if _, err = m.compose("restart", "--timeout", "60"); err != nil {
		return Result{}, err
	}
	if err = m.verifyServices(); err != nil {
		return Result{}, err
	}
	return Result{SchemaVersion: "alica-recovery-result/v1", Mode: "restart", Status: "PASS", Changed: true, CellID: m.Request.CellID, ReleaseID: state.AcceptedCurrent.ReleaseID, ManifestDigest: state.AcceptedCurrent.ManifestDigest, RTOMilliseconds: time.Since(started).Milliseconds(), Services: len(expectedServices)}, nil
}

func (m *Manager) OperationsCheck(synthetic bool) (OperationsReport, error) {
	state, err := m.acceptedState()
	if err != nil {
		return OperationsReport{}, err
	}
	report := OperationsReport{SchemaVersion: "alica-operations-report/v1", Status: "PASS", CellID: m.Request.CellID, ReleaseID: state.AcceptedCurrent.ReleaseID, CheckedAt: time.Now().UTC().Format(time.RFC3339Nano), Checks: []Check{}, SyntheticAlert: synthetic}
	add := func(name string, ok bool, detail string) {
		status := "PASS"
		if !ok {
			status = "FAIL"
			report.Status = "FAIL"
		}
		report.Checks = append(report.Checks, Check{Name: name, Status: status, Detail: detail})
	}
	age := m.backupAge()
	add("backup-age", age >= 0 && age <= m.Request.Operations.BackupMaxAgeSeconds, fmt.Sprintf("ageSeconds=%d maximum=%d", age, m.Request.Operations.BackupMaxAgeSeconds))
	free := freeBytes(m.Request.InstallationRoot)
	add("disk", free >= m.Request.Operations.MinimumFreeDiskBytes, fmt.Sprintf("freeBytes=%d minimum=%d", free, m.Request.Operations.MinimumFreeDiskBytes))
	status, certRemaining, canaryErr := m.canary()
	add("canary", canaryErr == nil && status >= 200 && status < 400, fmt.Sprintf("status=%d error=%v", status, canaryErr))
	add("certificate", canaryErr == nil && certRemaining >= m.Request.Operations.CertificateWarnSeconds, fmt.Sprintf("remainingSeconds=%d warning=%d", certRemaining, m.Request.Operations.CertificateWarnSeconds))
	serviceErr := m.verifyServices()
	add("unhealthy-service", serviceErr == nil, fmt.Sprintf("error=%v", serviceErr))
	driftErr := m.verifyDrift(state.AcceptedCurrent.ReleaseID)
	add("drift", driftErr == nil, fmt.Sprintf("error=%v", driftErr))
	if synthetic || report.Status == "FAIL" {
		report.AlertDelivered = m.deliverWebhook(report) == nil
		if !report.AlertDelivered {
			return report, errors.New("operations alert delivery failed")
		}
	}
	if synthetic && report.Status == "PASS" {
		report.Status = "ALERT"
	}
	return report, nil
}

func (m *Manager) installOperations() error {
	operationsRoot := filepath.Join(m.Request.InstallationRoot, "operations")
	unitRoot := filepath.Join(operationsRoot, "systemd")
	if err := os.MkdirAll(unitRoot, 0o700); err != nil {
		return err
	}
	binary := filepath.Join(operationsRoot, "alicactl")
	source, err := os.Executable()
	if err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(binary+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o500)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err == nil {
		err = out.Sync()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(binary+".tmp", binary); err != nil {
		return err
	}
	storedRequest := m.Request
	storedRequest.BackupID = ""
	requestPath := filepath.Join(operationsRoot, "recovery-request.json")
	if err = writeJSON(requestPath, storedRequest, 0o600); err != nil {
		return err
	}
	commonHardening := "User=root\nGroup=root\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=" + m.Request.InstallationRoot + " " + m.Request.LocalRepository + "\n"
	unitEnvironment := ""
	if m.TestMode {
		unitEnvironment = "Environment=ALICACTL_OPERATIONS_TEST_MODE=1\nEnvironment=ALICACTL_DOCKER_BIN=" + m.DockerBin + "\n"
	}
	units := map[string]string{
		"alica-backup.service": "[Unit]\nDescription=ALICA coordinated encrypted off-host backup\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\n" + unitEnvironment + commonHardening + "ExecStart=" + binary + " backup --request " + requestPath + " --json\n",
		"alica-backup.timer":   "[Unit]\nDescription=Daily ALICA coordinated backup\n\n[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=5m\nUnit=alica-backup.service\n\n[Install]\nWantedBy=timers.target\n",
		"alica-canary.service": "[Unit]\nDescription=ALICA runtime, backup, drift, disk and certificate canary\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\n" + unitEnvironment + commonHardening + "ExecStart=" + binary + " operations-check --request " + requestPath + " --json\n",
		"alica-canary.timer":   "[Unit]\nDescription=Five-minute ALICA operations canary\n\n[Timer]\nOnBootSec=5m\nOnUnitActiveSec=5m\nPersistent=true\nUnit=alica-canary.service\n\n[Install]\nWantedBy=timers.target\n",
	}
	names := make([]string, 0, len(units))
	for name := range units {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if err = os.WriteFile(filepath.Join(unitRoot, name), []byte(units[name]), 0o600); err != nil {
			return err
		}
	}
	if m.TestMode && os.Getenv("ALICACTL_OPERATIONS_ACTIVATE_TEST_UNITS") != "1" {
		return nil
	}
	if _, err = os.Stat("/run/systemd/system"); err != nil {
		return errors.New("systemd is required for D4 operations activation")
	}
	for _, name := range names {
		raw, readErr := os.ReadFile(filepath.Join(unitRoot, name))
		if readErr != nil {
			return readErr
		}
		if err = os.WriteFile(filepath.Join("/etc/systemd/system", name), raw, 0o644); err != nil {
			return err
		}
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", "--now", "alica-backup.timer", "alica-canary.timer"}} {
		command := exec.Command("systemctl", args...)
		if output, commandErr := command.CombinedOutput(); commandErr != nil {
			return fmt.Errorf("systemctl %s failed: %s", strings.Join(args, " "), safe(output))
		}
	}
	return nil
}

func (m *Manager) writeArchive(path string) ([]DataUnit, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	tw := tar.NewWriter(f)
	units := []DataUnit{}
	unit, err := addTree(tw, m.Request.InstallationRoot, "cell", map[string]bool{".alicactl.lock": true, "operations/last-backup.json": true})
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	unit.ID = "lifecycle-state"
	unit.Kind = "installation-root"
	units = append(units, unit)
	volumes, err := m.volumeMounts()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	names := make([]string, 0, len(volumes))
	for n := range volumes {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		u, e := addTree(tw, volumes[name], "volumes/"+name, nil)
		if e != nil {
			_ = f.Close()
			return nil, e
		}
		u.ID = name
		u.Kind = "docker-volume"
		units = append(units, u)
	}
	if err = tw.Close(); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	return units, err
}

func addTree(tw *tar.Writer, root, prefix string, exclude map[string]bool) (DataUnit, error) {
	h := sha256.New()
	var total int64
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if exclude != nil && exclude[rel] {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("backup refuses symbolic links: " + rel)
		}
		hdr, e := tar.FileInfoHeader(info, "")
		if e != nil {
			return e
		}
		hdr.Name = prefix + "/" + rel
		hdr.Uname = ""
		hdr.Gname = ""
		hdr.ModTime = time.Unix(0, 0)
		hdr.AccessTime = time.Time{}
		hdr.ChangeTime = time.Time{}
		if e = tw.WriteHeader(hdr); e != nil {
			return e
		}
		_, _ = io.WriteString(h, hdr.Name+"\x00"+info.Mode().String()+"\x00"+strconv.Itoa(hdr.Uid)+"\x00"+strconv.Itoa(hdr.Gid)+"\x00"+strconv.FormatInt(info.Size(), 10)+"\x00")
		if info.Mode().IsRegular() {
			f, e := os.Open(path)
			if e != nil {
				return e
			}
			n, e := io.Copy(io.MultiWriter(tw, h), f)
			_ = f.Close()
			total += n
			return e
		}
		return nil
	})
	return DataUnit{Digest: "sha256:" + hex.EncodeToString(h.Sum(nil)), Bytes: total}, err
}

func (m *Manager) extractCell(path string) error {
	return extractTar(path, func(name string) (string, bool, error) {
		if name == "cell" {
			return "", false, nil
		}
		if strings.HasPrefix(name, "cell/") {
			return filepath.Join(m.Request.InstallationRoot, strings.TrimPrefix(name, "cell/")), true, nil
		}
		return "", false, nil
	})
}
func (m *Manager) extractVolumes(path string) error {
	mounts, err := m.volumeMounts()
	if err != nil {
		return err
	}
	return extractTar(path, func(name string) (string, bool, error) {
		if !strings.HasPrefix(name, "volumes/") {
			return "", false, nil
		}
		rest := strings.TrimPrefix(name, "volumes/")
		volume, rel, ok := strings.Cut(rest, "/")
		if !ok {
			return "", false, nil
		}
		root, exists := mounts[volume]
		if !exists {
			return "", false, fmt.Errorf("restored archive contains undeclared volume %q", volume)
		}
		return filepath.Join(root, rel), true, nil
	})
}
func extractTar(path string, target func(string) (string, bool, error)) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	tr := tar.NewReader(f)
	for {
		hdr, e := tr.Next()
		if e == io.EOF {
			return nil
		}
		if e != nil {
			return e
		}
		dst, use, e := target(filepath.ToSlash(hdr.Name))
		if e != nil {
			return e
		}
		if !use {
			continue
		}
		clean := filepath.Clean(dst)
		if clean == "/" || strings.Contains(filepath.ToSlash(hdr.Name), "../") {
			return errors.New("unsafe archive path")
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if e = os.MkdirAll(clean, 0o700); e != nil {
				return e
			}
			if e = os.Chmod(clean, os.FileMode(hdr.Mode).Perm()); e != nil {
				return e
			}
			if e = os.Chown(clean, hdr.Uid, hdr.Gid); e != nil {
				return e
			}
		case tar.TypeReg:
			if e = os.MkdirAll(filepath.Dir(clean), 0o700); e != nil {
				return e
			}
			out, e := os.OpenFile(clean, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(hdr.Mode).Perm())
			if e != nil {
				return e
			}
			_, e = io.Copy(out, tr)
			closeErr := out.Close()
			if e != nil {
				return e
			}
			if closeErr != nil {
				return closeErr
			}
			if e = os.Chown(clean, hdr.Uid, hdr.Gid); e != nil {
				return e
			}
			if e = os.Chmod(clean, os.FileMode(hdr.Mode).Perm()); e != nil {
				return e
			}
		default:
			return errors.New("unsupported archive entry")
		}
	}
}

func encryptFile(src, dst string, keyRaw []byte) error {
	key := sha256.Sum256(append([]byte("ALICA-D4-BACKUP\x00"), keyRaw...))
	block, e := aes.NewCipher(key[:])
	if e != nil {
		return e
	}
	gcm, e := cipher.NewGCM(block)
	if e != nil {
		return e
	}
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if e != nil {
		return e
	}
	defer out.Close()
	prefix := make([]byte, 8)
	if _, e = rand.Read(prefix); e != nil {
		return e
	}
	if _, e = out.Write(append([]byte("ALICABK1"), prefix...)); e != nil {
		return e
	}
	buf := make([]byte, chunkSize)
	var counter uint32
	for {
		n, re := in.Read(buf)
		if n > 0 {
			nonce := append(append([]byte{}, prefix...), byte(counter>>24), byte(counter>>16), byte(counter>>8), byte(counter))
			sealed := gcm.Seal(nil, nonce, buf[:n], nil)
			if e = binary.Write(out, binary.BigEndian, uint32(len(sealed))); e != nil {
				return e
			}
			if _, e = out.Write(sealed); e != nil {
				return e
			}
			counter++
		}
		if re == io.EOF {
			break
		}
		if re != nil {
			return re
		}
	}
	if e = out.Sync(); e != nil {
		return e
	}
	return nil
}
func decryptFile(src, dst string, keyRaw []byte) error {
	key := sha256.Sum256(append([]byte("ALICA-D4-BACKUP\x00"), keyRaw...))
	block, e := aes.NewCipher(key[:])
	if e != nil {
		return e
	}
	gcm, e := cipher.NewGCM(block)
	if e != nil {
		return e
	}
	in, e := os.Open(src)
	if e != nil {
		return e
	}
	defer in.Close()
	header := make([]byte, 16)
	if _, e = io.ReadFull(in, header); e != nil || string(header[:8]) != "ALICABK1" {
		return errors.New("invalid encrypted backup header")
	}
	out, e := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if e != nil {
		return e
	}
	defer out.Close()
	var counter uint32
	for {
		var n uint32
		e = binary.Read(in, binary.BigEndian, &n)
		if e == io.EOF {
			break
		}
		if e != nil || n > chunkSize+uint32(gcm.Overhead()) {
			return errors.New("invalid encrypted backup chunk")
		}
		sealed := make([]byte, n)
		if _, e = io.ReadFull(in, sealed); e != nil {
			return e
		}
		nonce := append(append([]byte{}, header[8:]...), byte(counter>>24), byte(counter>>16), byte(counter>>8), byte(counter))
		plain, e := gcm.Open(nil, nonce, sealed, nil)
		if e != nil {
			return errors.New("backup decryption authentication failed")
		}
		if _, e = out.Write(plain); e != nil {
			return e
		}
		counter++
	}
	return out.Sync()
}

func (m *Manager) volumeMounts() (map[string]string, error) {
	out, err := m.docker("volume", "ls", "--filter", "label=com.alica.cell.id="+m.Request.CellID, "--format", "{{.Name}}")
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, full := range strings.Fields(out) {
		logical := strings.TrimPrefix(full, m.Request.Project+"_")
		if logical == full || logical == "" {
			return nil, fmt.Errorf("unexpected Cell volume %q", full)
		}
		mount, err := m.docker("volume", "inspect", full, "--format", "{{.Mountpoint}}")
		if err != nil {
			return nil, err
		}
		if !filepath.IsAbs(mount) {
			return nil, errors.New("Docker volume mountpoint is not absolute")
		}
		result[logical] = mount
	}
	if len(result) != 9 {
		return nil, fmt.Errorf("expected 9 Cell volumes, found %d", len(result))
	}
	return result, nil
}
func (m *Manager) acceptedState() (lifecycle.LifecycleState, error) {
	var state lifecycle.LifecycleState
	path := filepath.Join(m.Request.InstallationRoot, "accepted", "lifecycle-state.json")
	if err := contract.LoadClosedJSON(path, 64*1024, &state); err != nil {
		return state, err
	}
	if err := lifecycle.ValidateState(&state); err != nil {
		return state, err
	}
	if state.CellID != m.Request.CellID {
		return state, errors.New("accepted Cell ID mismatch")
	}
	return state, nil
}
func (m *Manager) compose(args ...string) (string, error) {
	base := []string{"compose", "--env-file", filepath.Join(m.Request.InstallationRoot, "release", "compose.env"), "-f", filepath.Join(m.Request.InstallationRoot, "release", "compose.yaml"), "--project-name", m.Request.Project}
	return m.docker(append(base, args...)...)
}
func (m *Manager) docker(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, m.DockerBin, args...)
	cmd.Env = append(os.Environ(), "DOCKER_CLI_HINTS=false")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker %s failed: %s", strings.Join(args, " "), safe(out))
	}
	return strings.TrimSpace(string(out)), nil
}
func (m *Manager) verifyServices() error {
	out, err := m.compose("ps", "--services", "--status", "running")
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, s := range strings.Fields(out) {
		seen[s] = true
	}
	for _, s := range expectedServices {
		if !seen[s] {
			return fmt.Errorf("service %s is not running", s)
		}
	}
	return nil
}
func (m *Manager) verifyDrift(release string) error {
	out, err := m.docker("ps", "-a", "--filter", "label=com.alica.cell.id="+m.Request.CellID, "--format", `{{.Label "com.alica.release.id"}}|{{.Label "com.alica.component.id"}}`)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) != 2 || parts[0] != release || seen[parts[1]] {
			return errors.New("Cell container label drift")
		}
		seen[parts[1]] = true
	}
	if len(seen) != len(expectedServices) {
		return fmt.Errorf("expected %d managed components, observed %d", len(expectedServices), len(seen))
	}
	return nil
}
func (m *Manager) canary() (int, int64, error) {
	u, err := url.Parse(m.Request.Operations.CanaryURL)
	if err != nil {
		return 0, 0, err
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: u.Hostname()}
	if m.TestMode {
		tlsConfig.InsecureSkipVerify = true
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	client := &http.Client{Timeout: 20 * time.Second, Transport: transport}
	response, err := client.Get(u.String())
	if err != nil {
		return 0, 0, err
	}
	_ = response.Body.Close()
	remaining := int64(0)
	if response.TLS != nil && len(response.TLS.PeerCertificates) > 0 {
		remaining = int64(time.Until(response.TLS.PeerCertificates[0].NotAfter).Seconds())
	}
	return response.StatusCode, remaining, nil
}
func (m *Manager) deliverWebhook(report OperationsReport) error {
	raw, _ := json.Marshal(report)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Post(m.Request.Operations.WebhookURL, "application/json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}
func (m *Manager) backupAge() int64 {
	var b BackupManifest
	if err := contract.LoadClosedJSON(filepath.Join(m.Request.InstallationRoot, "operations", "last-backup.json"), 1024*1024, &b); err != nil {
		return -1
	}
	t, err := time.Parse(time.RFC3339Nano, b.CreatedAt)
	if err != nil {
		return -1
	}
	age := int64(time.Since(t).Seconds())
	if age < 0 {
		return 0
	}
	return age
}
func (m *Manager) acquireKeyFiles() error {
	for _, p := range []string{m.Request.EncryptionKeyFile, m.Request.S3.AccessKeyFile, m.Request.S3.SecretAccessKeyFile} {
		if _, err := readSecretFile(p, m.TestMode); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) s3Put(name, path, contentType string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, _ := f.Stat()
	return m.s3Request(http.MethodPut, name, f, info.Size(), contentType, path)
}
func (m *Manager) s3Get(name, path string) error {
	return m.s3Request(http.MethodGet, name, nil, 0, "", path)
}
func (m *Manager) s3Request(method, name string, body io.Reader, size int64, contentType, target string) error {
	access, err := readSecretFile(m.Request.S3.AccessKeyFile, m.TestMode)
	if err != nil {
		return err
	}
	secret, err := readSecretFile(m.Request.S3.SecretAccessKeyFile, m.TestMode)
	if err != nil {
		return err
	}
	base, _ := url.Parse(strings.TrimSuffix(m.Request.S3.Endpoint, "/"))
	key := strings.Trim(strings.Trim(m.Request.S3.Prefix, "/")+"/"+name, "/")
	base.Path = "/" + m.Request.S3.Bucket + "/" + key
	payloadHash := "UNSIGNED-PAYLOAD"
	if method == http.MethodPut {
		digest, _, e := fileDigest(target)
		if e != nil {
			return e
		}
		payloadHash = strings.TrimPrefix(digest, "sha256:")
	}
	req, err := http.NewRequest(method, base.String(), body)
	if err != nil {
		return err
	}
	if size > 0 {
		req.ContentLength = size
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	date := now.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	canonicalURI := base.EscapedPath()
	canonicalHeaders := "host:" + base.Host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := method + "\n" + canonicalURI + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash
	scope := date + "/" + m.Request.S3.Region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + shaHex([]byte(canonicalRequest))
	signing := hmacSHA(hmacSHA(hmacSHA(hmacSHA([]byte("AWS4"+string(secret)), []byte(date)), []byte(m.Request.S3.Region)), []byte("s3")), []byte("aws4_request"))
	signature := hex.EncodeToString(hmacSHA(signing, []byte(stringToSign)))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+string(access)+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("S3 %s returned %d", method, resp.StatusCode)
	}
	if method == http.MethodGet {
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, resp.Body)
		syncErr := out.Sync()
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if syncErr != nil {
			return syncErr
		}
		return closeErr
	}
	return nil
}

func manifestMAC(m BackupManifest, key []byte) string {
	m.ManifestMAC = ""
	raw, _ := json.Marshal(m)
	mac := hmac.New(sha256.New, sha256Sum(append([]byte("ALICA-D4-MANIFEST\x00"), key...)))
	_, _ = mac.Write(raw)
	return "hmac-sha256:" + hex.EncodeToString(mac.Sum(nil))
}
func readSecretFile(path string, test bool) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("secret file must be regular and mode 0600 or stricter")
	}
	if !test {
		if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Uid != 0 {
			return nil, errors.New("secret file must be root-owned")
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) < 16 || len(raw) > 16*1024 || bytes.ContainsAny(raw, "\r\n") {
		return nil, errors.New("secret file must contain one 16..16384 byte line")
	}
	return raw, nil
}
func fileDigest(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), n, err
}
func writeJSON(path string, v any, mode os.FileMode) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temp := path + ".tmp"
	if err = os.WriteFile(temp, append(raw, '\n'), mode); err != nil {
		return err
	}
	if err = os.Chmod(temp, mode); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
func freeBytes(path string) int64 {
	candidate := path
	for {
		if _, e := os.Stat(candidate); e == nil {
			break
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return 0
		}
		candidate = parent
	}
	var s syscall.Statfs_t
	if syscall.Statfs(candidate, &s) != nil {
		return 0
	}
	return int64(s.Bavail) * int64(s.Bsize)
}
func pathWithin(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && (rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."))
}
func safe(raw []byte) string {
	s := strings.TrimSpace(string(raw))
	if len(s) > 4096 {
		s = s[:4096]
	}
	return s
}
func shaHex(b []byte) string    { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
func sha256Sum(b []byte) []byte { v := sha256.Sum256(b); return v[:] }
func hmacSHA(key, data []byte) []byte {
	var h hash.Hash = hmac.New(sha256.New, key)
	_, _ = h.Write(data)
	return h.Sum(nil)
}
func validTypedID(value, prefix string) bool {
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	u := strings.TrimPrefix(value, prefix)
	if len(u) != 36 || u[8] != '-' || u[13] != '-' || u[18] != '-' || u[23] != '-' || u[14] != '7' || !strings.ContainsRune("89ab", rune(u[19])) {
		return false
	}
	for i, c := range u {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
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
