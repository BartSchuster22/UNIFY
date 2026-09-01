package update

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"strings"
	"syscall"
	"time"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/recovery"
)

const maxRequestBytes = 128 * 1024

type Request struct {
	SchemaVersion    string `json:"schemaVersion"`
	CellID           string `json:"cellId"`
	InstallationRoot string `json:"installationRoot"`
	Project          string `json:"project"`
	Channel          string `json:"channel"`
	ExpectedCurrent  struct {
		ReleaseID      string `json:"releaseId"`
		ManifestDigest string `json:"manifestDigest"`
	} `json:"expectedCurrent"`
	RootMetadata         string `json:"rootMetadata"`
	TimestampMetadata    string `json:"timestampMetadata"`
	SnapshotMetadata     string `json:"snapshotMetadata"`
	TargetsMetadata      string `json:"targetsMetadata"`
	PinnedRootDigest     string `json:"pinnedRootDigest"`
	RecoveryRequest      string `json:"recoveryRequest"`
	ManualApproval       bool   `json:"manualApproval"`
	RiskAcceptanceDigest string `json:"riskAcceptanceDigest"`
}

type Result struct {
	SchemaVersion        string `json:"schemaVersion"`
	Mode                 string `json:"mode"`
	Status               string `json:"status"`
	Changed              bool   `json:"changed"`
	CellID               string `json:"cellId"`
	SourceReleaseID      string `json:"sourceReleaseId"`
	TargetReleaseID      string `json:"targetReleaseId"`
	TargetManifestDigest string `json:"targetManifestDigest"`
	BackupID             string `json:"backupId,omitempty"`
	TrustRootVersion     int64  `json:"trustRootVersion"`
	TimestampVersion     int64  `json:"timestampVersion"`
	SnapshotVersion      int64  `json:"snapshotVersion"`
	TargetsVersion       int64  `json:"targetsVersion"`
	Services             int    `json:"services,omitempty"`
	MutationPerformed    bool   `json:"mutationPerformed"`
}

type Signature struct {
	KeyID string `json:"keyid"`
	Sig   string `json:"sig"`
}
type Envelope struct {
	Signed     json.RawMessage `json:"signed"`
	Signatures []Signature     `json:"signatures"`
}
type Key struct {
	KeyType string `json:"keytype"`
	Scheme  string `json:"scheme"`
	KeyVal  struct {
		Public string `json:"public"`
	} `json:"keyval"`
}
type Role struct {
	KeyIDs    []string `json:"keyids"`
	Threshold int      `json:"threshold"`
}
type RootSigned struct {
	Type               string          `json:"_type"`
	SpecVersion        string          `json:"spec_version"`
	Version            int64           `json:"version"`
	Expires            string          `json:"expires"`
	ConsistentSnapshot bool            `json:"consistent_snapshot"`
	Keys               map[string]Key  `json:"keys"`
	Roles              map[string]Role `json:"roles"`
}
type Meta struct {
	Version int64             `json:"version"`
	Length  int64             `json:"length"`
	Hashes  map[string]string `json:"hashes"`
}
type TimestampSigned struct {
	Type    string          `json:"_type"`
	Version int64           `json:"version"`
	Expires string          `json:"expires"`
	Meta    map[string]Meta `json:"meta"`
}
type SnapshotSigned struct {
	Type    string          `json:"_type"`
	Version int64           `json:"version"`
	Expires string          `json:"expires"`
	Meta    map[string]Meta `json:"meta"`
}
type Target struct {
	Length int64             `json:"length"`
	Hashes map[string]string `json:"hashes"`
	Custom struct {
		ReleaseID      string `json:"releaseId"`
		ManifestDigest string `json:"manifestDigest"`
		Channel        string `json:"channel"`
		ReleaseClass   string `json:"releaseClass"`
	} `json:"custom"`
}
type TargetsSigned struct {
	Type    string            `json:"_type"`
	Version int64             `json:"version"`
	Expires string            `json:"expires"`
	Targets map[string]Target `json:"targets"`
}
type trustVersions struct{ Root, Timestamp, Snapshot, Targets int64 }
type UpdateState struct {
	SchemaVersion        string        `json:"schemaVersion"`
	SourceReleaseID      string        `json:"sourceReleaseId"`
	SourceManifestDigest string        `json:"sourceManifestDigest"`
	TargetReleaseID      string        `json:"targetReleaseId"`
	TargetManifestDigest string        `json:"targetManifestDigest"`
	BackupID             string        `json:"backupId"`
	Channel              string        `json:"channel"`
	AcceptedAt           string        `json:"acceptedAt"`
	Trust                trustVersions `json:"trustVersions"`
}

type Manager struct {
	Target                                                 *contract.Manifest
	TargetDigest                                           string
	TargetManifestPath, TargetSignaturePath, TargetKeyPath string
	Request                                                Request
	DockerBin                                              string
	TestMode                                               bool
	versions                                               trustVersions
	state                                                  lifecycle.LifecycleState
	journal                                                lifecycle.OperationJournal
	declaration                                            lifecycle.CellDeclaration
	lock                                                   *os.File
}

func LoadRequest(path string) (Request, error) {
	var r Request
	if err := contract.LoadClosedJSON(path, maxRequestBytes, &r); err != nil {
		return r, fmt.Errorf("update request: %w", err)
	}
	return r, validateRequest(r)
}
func validateRequest(r Request) error {
	if r.SchemaVersion != "alica-update/v1" || !r.ManualApproval {
		return errors.New("unsupported update request or missing manual approval")
	}
	if !strings.HasPrefix(r.CellID, "ins_") || r.Project == "" || strings.ContainsAny(r.Project, " ./\\") {
		return errors.New("invalid Cell or project identity")
	}
	if r.Channel != "candidate" {
		return errors.New("D5 accepts only the candidate channel")
	}
	for n, p := range map[string]string{"installationRoot": r.InstallationRoot, "rootMetadata": r.RootMetadata, "timestampMetadata": r.TimestampMetadata, "snapshotMetadata": r.SnapshotMetadata, "targetsMetadata": r.TargetsMetadata, "recoveryRequest": r.RecoveryRequest} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p {
			return fmt.Errorf("%s must be a clean absolute path", n)
		}
	}
	if r.InstallationRoot == "/" || !digest(r.ExpectedCurrent.ManifestDigest) || !digest(r.PinnedRootDigest) || !digest(r.RiskAcceptanceDigest) {
		return errors.New("invalid installation root or digest binding")
	}
	return nil
}
func New(target *contract.Manifest, digestValue, manifestPath, signaturePath, keyPath string, r Request) (*Manager, error) {
	if target == nil || !target.Installable {
		return nil, errors.New("target release is not installable")
	}
	if err := validateRequest(r); err != nil {
		return nil, err
	}
	test := os.Getenv("ALICACTL_UPDATE_TEST_MODE") == "1"
	docker := "docker"
	if test {
		docker = os.Getenv("ALICACTL_DOCKER_BIN")
		if docker == "" {
			return nil, errors.New("update test mode requires ALICACTL_DOCKER_BIN")
		}
	}
	m := &Manager{Target: target, TargetDigest: digestValue, TargetManifestPath: manifestPath, TargetSignaturePath: signaturePath, TargetKeyPath: keyPath, Request: r, DockerBin: docker, TestMode: test}
	if err := m.preflight(); err != nil {
		return nil, err
	}
	return m, nil
}
func (m *Manager) Plan() (Result, error) { return m.result("update-plan", false, "", 0), nil }
func (m *Manager) Apply() (res Result, err error) {
	if err = m.acquireLock(); err != nil {
		return res, err
	}
	defer m.releaseLock()
	recoveryRequest, e := recovery.LoadRequest(m.Request.RecoveryRequest)
	if e != nil {
		return res, e
	}
	if recoveryRequest.CellID != m.Request.CellID || recoveryRequest.InstallationRoot != m.Request.InstallationRoot || recoveryRequest.Project != m.Request.Project {
		return res, errors.New("recovery request is not bound to this Cell")
	}
	rm, e := recovery.New(recoveryRequest)
	if e != nil {
		return res, e
	}
	backup, e := rm.Backup()
	if e != nil {
		return res, fmt.Errorf("mandatory pre-update backup: %w", e)
	}
	if !backup.OffHostReplicated {
		return res, errors.New("mandatory backup lacks off-host replication")
	}
	operationID := typedID("op_")
	root := m.Request.InstallationRoot
	current := filepath.Join(root, "release")
	stage := filepath.Join(root, ".update-staging-"+operationID)
	previous := filepath.Join(root, "releases", m.state.AcceptedCurrent.ReleaseID)
	if err = copyTree(current, stage); err != nil {
		return res, err
	}
	defer func() {
		if err != nil {
			_ = os.RemoveAll(stage)
		}
	}()
	for src, name := range map[string]string{m.TargetManifestPath: "release-manifest.json", m.TargetSignaturePath: "release-manifest.sig.json", m.TargetKeyPath: "release-trust-key.json"} {
		raw, x := os.ReadFile(src)
		if x != nil {
			return res, x
		}
		if x = writeAtomic(filepath.Join(stage, name), raw, 0o444); x != nil {
			return res, x
		}
	}
	if err = replaceEnv(filepath.Join(stage, "compose.env"), "ALICA_RELEASE_ID", m.Target.ReleaseID); err != nil {
		return res, err
	}
	if err = os.MkdirAll(filepath.Dir(previous), 0o750); err != nil {
		return res, err
	}
	if _, x := os.Stat(previous); x == nil {
		return res, errors.New("previous release archive already exists")
	}
	if err = os.Rename(current, previous); err != nil {
		return res, err
	}
	promoted := false
	defer func() {
		if err != nil && !promoted {
			_ = os.Rename(previous, current)
		}
	}()
	if err = os.Rename(stage, current); err != nil {
		return res, err
	}
	var activationErr error
	if m.TestMode && os.Getenv("ALICACTL_UPDATE_FAIL_PHASE") == "activate" {
		activationErr = errors.New("injected target activation failure")
	} else {
		_, activationErr = m.compose(current, "--profile", "minimum-cell", "up", "-d", "--wait")
	}
	if activationErr != nil {
		_ = os.RemoveAll(current)
		_ = os.Rename(previous, current)
		_, _ = m.compose(current, "--profile", "minimum-cell", "up", "-d", "--wait")
		return res, fmt.Errorf("target activation rolled back before acceptance: %w", activationErr)
	}
	if err = m.verifyRuntime(current); err != nil {
		_ = os.RemoveAll(current)
		_ = os.Rename(previous, current)
		_, _ = m.compose(current, "--profile", "minimum-cell", "up", "-d", "--wait")
		return res, fmt.Errorf("target verification rolled back before acceptance: %w", err)
	}
	if err = m.commit(operationID, backup.BackupID); err != nil {
		return res, err
	}
	promoted = true
	return m.result("update", true, backup.BackupID, 10), nil
}
func (m *Manager) preflight() error {
	if err := loadJSON(filepath.Join(m.Request.InstallationRoot, "accepted", "lifecycle-state.json"), &m.state); err != nil {
		return err
	}
	if err := loadJSON(filepath.Join(m.Request.InstallationRoot, "accepted", "operation-journal.json"), &m.journal); err != nil {
		return err
	}
	if err := loadJSON(filepath.Join(m.Request.InstallationRoot, "accepted", "cell-declaration.json"), &m.declaration); err != nil {
		return err
	}
	if m.state.CellID != m.Request.CellID || m.state.AcceptedCurrent.ReleaseID != m.Request.ExpectedCurrent.ReleaseID || m.state.AcceptedCurrent.ManifestDigest != m.Request.ExpectedCurrent.ManifestDigest {
		return errors.New("accepted-current does not match approved source")
	}
	if m.Target.ReleaseID == m.state.AcceptedCurrent.ReleaseID || m.TargetDigest == m.state.AcceptedCurrent.ManifestDigest {
		return errors.New("target must differ from source")
	}
	if err := m.compatibility(); err != nil {
		return err
	}
	versions, err := verifyMetadata(m.Request, m.Target, m.TargetDigest, m.TargetManifestPath)
	if err != nil {
		return err
	}
	m.versions = versions
	var old UpdateState
	if loadJSON(filepath.Join(m.Request.InstallationRoot, "accepted", "update-state.json"), &old) == nil {
		if versions.Root < old.Trust.Root || versions.Timestamp <= old.Trust.Timestamp || versions.Snapshot <= old.Trust.Snapshot || versions.Targets <= old.Trust.Targets {
			return errors.New("trusted metadata rollback or replay rejected")
		}
	}
	return nil
}
func (m *Manager) compatibility() error {
	ok := false
	for _, o := range m.Target.Compatibility.SupportedOrigins {
		profile := false
		for _, p := range o.Profiles {
			if p == m.state.AcceptedCurrent.Profile {
				profile = true
			}
		}
		if o.ReleaseID == m.state.AcceptedCurrent.ReleaseID && o.ManifestDigest == m.state.AcceptedCurrent.ManifestDigest && profile && len(o.Evidence) > 0 {
			ok = true
		}
	}
	if !ok {
		return errors.New("target does not declare the exact directional source edge")
	}
	if len(m.Target.MigrationPlan.Steps) != 0 || len(m.Target.IrreversibleChanges) != 0 {
		return errors.New("D5 candidate must be a reversible definition-only edge")
	}
	rollback := false
	for _, target := range m.Target.Rollback.SupportedTargets {
		if target.ReleaseID == m.state.AcceptedCurrent.ReleaseID && target.Class == "definition_rollback" && target.Evidence != "" {
			rollback = true
		}
	}
	if !rollback {
		return errors.New("target rollback declaration is not bound to source")
	}
	return nil
}
func verifyMetadata(r Request, target *contract.Manifest, targetDigest, manifestPath string) (trustVersions, error) {
	paths := []string{r.RootMetadata, r.TimestampMetadata, r.SnapshotMetadata, r.TargetsMetadata}
	raw := make([][]byte, 4)
	for i, p := range paths {
		b, e := os.ReadFile(p)
		if e != nil {
			return trustVersions{}, e
		}
		raw[i] = b
	}
	if sha(raw[0]) != r.PinnedRootDigest {
		return trustVersions{}, errors.New("pinned root digest mismatch")
	}
	var rootEnv, tsEnv, snapEnv, targEnv Envelope
	for i, v := range []*Envelope{&rootEnv, &tsEnv, &snapEnv, &targEnv} {
		if err := closed(raw[i], v); err != nil {
			return trustVersions{}, err
		}
	}
	var root RootSigned
	if err := closed(rootEnv.Signed, &root); err != nil {
		return trustVersions{}, err
	}
	if root.Type != "root" || root.SpecVersion != "1.0.31" || !root.ConsistentSnapshot {
		return trustVersions{}, errors.New("invalid trusted root")
	}
	if err := fresh(root.Expires); err != nil {
		return trustVersions{}, err
	}
	if err := threshold(rootEnv, root.Roles["root"], root.Keys); err != nil {
		return trustVersions{}, fmt.Errorf("root threshold: %w", err)
	}
	var ts TimestampSigned
	var snap SnapshotSigned
	var targets TargetsSigned
	if err := closed(tsEnv.Signed, &ts); err != nil {
		return trustVersions{}, err
	}
	if err := closed(snapEnv.Signed, &snap); err != nil {
		return trustVersions{}, err
	}
	if err := closed(targEnv.Signed, &targets); err != nil {
		return trustVersions{}, err
	}
	for _, v := range []struct {
		e Envelope
		r string
	}{{tsEnv, "timestamp"}, {snapEnv, "snapshot"}, {targEnv, "targets"}} {
		if err := threshold(v.e, root.Roles[v.r], root.Keys); err != nil {
			return trustVersions{}, fmt.Errorf("%s threshold: %w", v.r, err)
		}
	}
	if ts.Type != "timestamp" || snap.Type != "snapshot" || targets.Type != "targets" {
		return trustVersions{}, errors.New("metadata role type mismatch")
	}
	for _, x := range []string{ts.Expires, snap.Expires, targets.Expires} {
		if err := fresh(x); err != nil {
			return trustVersions{}, err
		}
	}
	if err := matchMeta(ts.Meta["snapshot.json"], raw[2], snap.Version); err != nil {
		return trustVersions{}, fmt.Errorf("snapshot binding: %w", err)
	}
	if err := matchMeta(snap.Meta["targets.json"], raw[3], targets.Version); err != nil {
		return trustVersions{}, fmt.Errorf("targets binding: %w", err)
	}
	name := "releases/" + target.ReleaseID + "/manifest.json"
	entry, ok := targets.Targets[name]
	if !ok {
		return trustVersions{}, errors.New("target manifest is absent from targets metadata")
	}
	manifestRaw, e := os.ReadFile(manifestPath)
	if e != nil {
		return trustVersions{}, e
	}
	if entry.Length != int64(len(manifestRaw)) || entry.Hashes["sha256"] != strings.TrimPrefix(sha(manifestRaw), "sha256:") || entry.Custom.ManifestDigest != targetDigest || entry.Custom.ReleaseID != target.ReleaseID || entry.Custom.Channel != r.Channel || entry.Custom.ReleaseClass != target.ReleaseClass {
		return trustVersions{}, errors.New("target metadata binding mismatch")
	}
	return trustVersions{root.Version, ts.Version, snap.Version, targets.Version}, nil
}

func threshold(e Envelope, role Role, keys map[string]Key) error {
	if role.Threshold < 1 || len(role.KeyIDs) < role.Threshold {
		return errors.New("invalid role threshold")
	}
	allowed := map[string]bool{}
	for _, id := range role.KeyIDs {
		allowed[id] = true
	}
	seen := map[string]bool{}
	valid := 0
	canonical, err := canonicalRaw(e.Signed)
	if err != nil {
		return err
	}
	for _, s := range e.Signatures {
		if seen[s.KeyID] || !allowed[s.KeyID] {
			continue
		}
		seen[s.KeyID] = true
		k, ok := keys[s.KeyID]
		if !ok || k.KeyType != "ed25519" || k.Scheme != "ed25519" {
			continue
		}
		pub, x := base64.StdEncoding.DecodeString(k.KeyVal.Public)
		sig, x2 := base64.StdEncoding.DecodeString(s.Sig)
		if x == nil && x2 == nil && ed25519.Verify(pub, canonical, sig) {
			valid++
		}
	}
	if valid < role.Threshold {
		return fmt.Errorf("have %d valid signatures, require %d", valid, role.Threshold)
	}
	return nil
}
func matchMeta(m Meta, raw []byte, version int64) error {
	if m.Version != version || m.Length != int64(len(raw)) || m.Hashes["sha256"] != strings.TrimPrefix(sha(raw), "sha256:") {
		return errors.New("version/length/digest mismatch")
	}
	return nil
}
func fresh(v string) error {
	t, e := time.Parse(time.RFC3339, v)
	if e != nil || !t.After(time.Now().UTC()) {
		return errors.New("expired or invalid trusted metadata")
	}
	return nil
}
func canonicalRaw(raw []byte) ([]byte, error) {
	var v any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e := d.Decode(&v); e != nil {
		return nil, e
	}
	return contract.CanonicalJSON(v)
}
func closed(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return e
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
func loadJSON(path string, out any) error {
	raw, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return closed(raw, out)
}
func (m *Manager) acquireLock() error {
	f, e := os.OpenFile(filepath.Join(m.Request.InstallationRoot, ".alicactl.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if e != nil {
		return e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return errors.New("another lifecycle operation holds the Cell lock")
	}
	m.lock = f
	return nil
}
func (m *Manager) releaseLock() {
	if m.lock != nil {
		_ = syscall.Flock(int(m.lock.Fd()), syscall.LOCK_UN)
		_ = m.lock.Close()
		_ = os.Remove(filepath.Join(m.Request.InstallationRoot, ".alicactl.lock"))
	}
}
func (m *Manager) compose(release string, args ...string) (string, error) {
	base := []string{"compose", "--env-file", filepath.Join(release, "compose.env"), "-f", filepath.Join(release, "compose.yaml"), "--project-name", m.Request.Project}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, m.DockerBin, append(base, args...)...)
	out, e := cmd.CombinedOutput()
	if e != nil {
		return "", fmt.Errorf("docker compose failed: %s", safe(out))
	}
	return strings.TrimSpace(string(out)), nil
}
func (m *Manager) verifyRuntime(release string) error {
	out, e := m.compose(release, "ps", "--services", "--status", "running")
	if e != nil {
		return e
	}
	seen := map[string]bool{}
	for _, x := range strings.Fields(out) {
		seen[x] = true
	}
	for _, x := range []string{"ainba-anchor", "alica", "caddy", "doghouse-node", "herman", "keycloak", "memory-v4", "postgresql", "unify-core", "uniui"} {
		if !seen[x] {
			return fmt.Errorf("required service %s is not running", x)
		}
	}
	return nil
}
func (m *Manager) commit(op, backup string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	state := lifecycle.LifecycleState{SchemaVersion: "alica-lifecycle-state/v1", CellID: m.Request.CellID, Phase: "accepted", AcceptedCurrent: lifecycle.AcceptedCurrent{ReleaseID: m.Target.ReleaseID, ManifestDigest: m.TargetDigest, Profile: m.Target.Product.Profile, AcceptedAt: now}}
	prev := strings.Repeat("0", 64)
	seq := 1
	if n := len(m.journal.Entries); n > 0 {
		prev = strings.TrimPrefix(m.journal.Entries[n-1].EntryDigest, "sha256:")
		seq = m.journal.Entries[n-1].Sequence + 1
	}
	entry := lifecycle.OperationJournalEntry{OperationID: op, Sequence: seq, Kind: "update", OccurredAt: now, SourceReleaseID: m.state.AcceptedCurrent.ReleaseID, TargetReleaseID: m.Target.ReleaseID, TargetManifestDigest: m.TargetDigest, Phase: "accepted", Result: "succeeded", MutationAuthorized: true, EvidenceDigests: []string{m.Request.PinnedRootDigest, m.Request.RiskAcceptanceDigest}, PreviousEntryDigest: "sha256:" + prev}
	entry.EntryDigest = journalDigest(entry)
	m.journal.Entries = append(m.journal.Entries, entry)
	us := UpdateState{SchemaVersion: "alica-update-state/v1", SourceReleaseID: m.state.AcceptedCurrent.ReleaseID, SourceManifestDigest: m.state.AcceptedCurrent.ManifestDigest, TargetReleaseID: m.Target.ReleaseID, TargetManifestDigest: m.TargetDigest, BackupID: backup, Channel: m.Request.Channel, AcceptedAt: now, Trust: m.versions}
	stage := filepath.Join(m.Request.InstallationRoot, ".accepted-update-"+op)
	if e := os.MkdirAll(stage, 0o750); e != nil {
		return e
	}
	for n, v := range map[string]any{"cell-declaration.json": m.declaration, "lifecycle-state.json": state, "operation-journal.json": m.journal, "update-state.json": us} {
		if e := writeJSON(filepath.Join(stage, n), v, 0o640); e != nil {
			return e
		}
	}
	accepted := filepath.Join(m.Request.InstallationRoot, "accepted")
	old := accepted + ".old-" + op
	if e := os.Rename(accepted, old); e != nil {
		return e
	}
	if e := os.Rename(stage, accepted); e != nil {
		_ = os.Rename(old, accepted)
		return e
	}
	return os.RemoveAll(old)
}
func (m *Manager) result(mode string, changed bool, backup string, services int) Result {
	return Result{SchemaVersion: "alica-update-result/v1", Mode: mode, Status: "PASS", Changed: changed, CellID: m.Request.CellID, SourceReleaseID: m.state.AcceptedCurrent.ReleaseID, TargetReleaseID: m.Target.ReleaseID, TargetManifestDigest: m.TargetDigest, BackupID: backup, TrustRootVersion: m.versions.Root, TimestampVersion: m.versions.Timestamp, SnapshotVersion: m.versions.Snapshot, TargetsVersion: m.versions.Targets, Services: services, MutationPerformed: changed}
}
func journalDigest(e lifecycle.OperationJournalEntry) string {
	e.EntryDigest = ""
	raw, _ := json.Marshal(e)
	c, _ := canonicalRaw(raw)
	h := sha256.Sum256(c)
	return "sha256:" + hex.EncodeToString(h[:])
}
func replaceEnv(path, key, value string) error {
	raw, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	found := false
	for i, l := range lines {
		if strings.HasPrefix(l, key+"=") {
			lines[i] = key + "=" + value
			found = true
		}
	}
	if !found {
		return errors.New("release environment lacks " + key)
	}
	return writeAtomic(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}
func copyTree(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		if !info.Mode().IsRegular() {
			return errors.New("non-regular release entry rejected")
		}
		in, e := os.Open(path)
		if e != nil {
			return e
		}
		defer in.Close()
		out, e := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode())
		if e != nil {
			return e
		}
		_, e = io.Copy(out, in)
		if e == nil {
			e = out.Sync()
		}
		ce := out.Close()
		if e == nil {
			e = ce
		}
		return e
	})
}
func writeJSON(path string, v any, mode os.FileMode) error {
	raw, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	return writeAtomic(path, append(raw, '\n'), mode)
}
func writeAtomic(path string, b []byte, mode os.FileMode) error {
	if e := os.MkdirAll(filepath.Dir(path), 0o750); e != nil {
		return e
	}
	tmp := path + ".tmp"
	f, e := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if e != nil {
		return e
	}
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	if ce := f.Close(); e == nil {
		e = ce
	}
	if e != nil {
		_ = os.Remove(tmp)
		return e
	}
	return os.Rename(tmp, path)
}
func typedID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 15) | 112
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%s%08x-%04x-%04x-%04x-%012x", prefix, b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func sha(b []byte) string { h := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(h[:]) }
func digest(s string) bool {
	if len(s) != 71 || !strings.HasPrefix(s, "sha256:") {
		return false
	}
	_, e := hex.DecodeString(strings.TrimPrefix(s, "sha256:"))
	return e == nil
}
func safe(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 2048 {
		s = s[:2048]
	}
	return s
}
