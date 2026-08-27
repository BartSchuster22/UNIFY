package lifecycle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
)

func loadFixtures(t *testing.T) (*contract.Manifest, string, *Observation) {
	t.Helper()
	root := filepath.Join("..", "..", "testdata")
	manifest, digest, err := contract.LoadAndVerify(filepath.Join(root, "d1-contract.manifest.json"), filepath.Join(root, "d1-contract.manifest.signature.json"), filepath.Join(root, "d1-test-public-key.json"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "observed-conformant.json"))
	if err != nil {
		t.Fatal(err)
	}
	var observation Observation
	if err = json.Unmarshal(raw, &observation); err != nil {
		t.Fatal(err)
	}
	return manifest, digest, &observation
}
func cloneObservation(value *Observation) *Observation {
	raw, _ := json.Marshal(value)
	var result Observation
	_ = json.Unmarshal(raw, &result)
	return &result
}
func TestConformantVerifyPasses(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	t.Setenv("ALICACTL_NOW", "2026-08-27T21:00:00Z")
	m, d, o := loadFixtures(t)
	r := Evaluate("verify", m, d, o)
	if r.Status != "PASS" || r.Summary.Failed != 0 || len(r.Drift) != 0 || r.MutationPerformed {
		t.Fatalf("unexpected report: %+v", r)
	}
	if r.GeneratedAt != "2026-08-27T21:00:00Z" {
		t.Fatal(r.GeneratedAt)
	}
}
func TestNotInstalledStatusIsTruthful(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	m, d, o := loadFixtures(t)
	o.State = nil
	o.Declaration = nil
	o.Journal = nil
	o.Containers = nil
	o.Networks = nil
	o.Volumes = nil
	o.HostUnits = nil
	r := Evaluate("status", m, d, o)
	if r.Status != "NOT_INSTALLED" {
		t.Fatalf("got %s", r.Status)
	}
}
func TestDriftClassesFailClosed(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	m, d, base := loadFixtures(t)
	cases := map[string]func(*Observation){
		"release":  func(o *Observation) { o.State.AcceptedCurrent.ReleaseID = "rel_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b99" },
		"manifest": func(o *Observation) { o.State.AcceptedCurrent.ManifestDigest = "sha256:" + strings.Repeat("0", 64) },
		"profile":  func(o *Observation) { o.State.AcceptedCurrent.Profile = "dsh-standard/v1" },
		"identity": func(o *Observation) { o.Declaration.CellID = "ins_0198f3c0-7b00-7a11-8c21-4f5d6e7a8b99" },
		"journal":  func(o *Observation) { o.Journal.Entries[len(o.Journal.Entries)-1].Phase = "failed" },
		"digest":   func(o *Observation) { o.Containers[0].ImageDigest = "sha256:" + strings.Repeat("0", 64) },
		"health":   func(o *Observation) { o.Containers[0].Health = "unhealthy" },
		"missing":  func(o *Observation) { o.Containers = o.Containers[1:] },
		"extra": func(o *Observation) {
			extra := o.Containers[0]
			extra.ComponentID = "rogue"
			extra.Name = "rogue"
			o.Containers = append(o.Containers, extra)
		},
		"network": func(o *Observation) { o.Networks[0].Internal = !o.Networks[0].Internal },
		"volume":  func(o *Observation) { o.Volumes[0].Authority = "rogue" },
		"unit":    func(o *Observation) { o.HostUnits[0].ActiveState = "inactive" },
		"port":    func(o *Observation) { o.Containers[0].PublishedPorts[0].Published = 8080 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			o := cloneObservation(base)
			mutate(o)
			r := Evaluate("verify", m, d, o)
			if r.Status != "FAIL" || len(r.Drift) == 0 {
				t.Fatalf("mutation accepted: %+v", r)
			}
		})
	}
}
func TestDockerCandidateInventoryUnionsCellProjectAndName(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "docker-readonly-mock")
	script := `#!/bin/sh
case "$*" in
  *com.alica.cell.id*) printf 'known\n' ;;
  *com.docker.compose.project*) printf 'rogue-project\n' ;;
  *name=*) printf 'known\nrogue-name\n' ;;
esac
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ALICACTL_DOCKER_BIN", binary)
	ids, err := dockerResourceIDs(
		[]string{"ps", "-aq", "--filter", "label=com.alica.cell.id=ins_test"},
		[]string{"ps", "-aq", "--filter", "label=com.docker.compose.project=alica"},
		[]string{"ps", "-aq", "--filter", "name=^/alica-"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(ids, ",") != "known,rogue-name,rogue-project" {
		t.Fatalf("unexpected candidate inventory: %v", ids)
	}
}

func TestUnsupportedPlatformFailsPreflight(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	m, d, o := loadFixtures(t)
	o.Host.OSID = "ubuntu"
	o.Host.OSVersion = "22.04"
	o.Host.DockerVersion = "29.0.0"
	o.Host.MemoryBytes = 1024
	r := Evaluate("preflight", m, d, o)
	if r.Status != "FAIL" || r.Summary.Failed < 3 {
		t.Fatalf("unsupported platform accepted: %+v", r)
	}
}

func TestObservationDuplicateKeysRejected(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	manifest, _, _ := loadFixtures(t)
	path := filepath.Join("..", "..", "testdata", "observed-conformant.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	tampered := strings.Replace(string(raw), `"schemaVersion": "alica-observed-state/v1",`, `"schemaVersion": "alica-observed-state/v1", "schemaVersion": "alica-observed-state/v1",`, 1)
	tamperedPath := filepath.Join(t.TempDir(), "duplicate.json")
	if err := os.WriteFile(tamperedPath, []byte(tampered), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Observe("/", manifest, tamperedPath); err == nil {
		t.Fatal("duplicate observation key accepted")
	}
}

func TestObservationBrokenJournalChainRejected(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	manifest, _, observation := loadFixtures(t)
	observation.Journal.Entries[1].PreviousEntryDigest = "sha256:" + strings.Repeat("0", 64)
	raw, err := json.Marshal(observation)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "broken-journal.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Observe("/", manifest, path); err == nil {
		t.Fatal("broken operation journal chain accepted")
	}
}
