package contract

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixturePath(name string) string { return filepath.Join("..", "..", "testdata", name) }

func signForTest(manifestPath, keyID string, privateKey ed25519.PrivateKey) (SignatureEnvelope, TrustKey, error) {
	_, canonical, digest, err := LoadManifest(manifestPath)
	if err != nil {
		return SignatureEnvelope{}, TrustKey{}, err
	}
	publicKey := privateKey.Public().(ed25519.PublicKey)
	return SignatureEnvelope{
		SchemaVersion:  "alica-manifest-signature/v1",
		Algorithm:      "ed25519",
		KeyID:          keyID,
		ManifestDigest: digest,
		Signature:      base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, canonical)),
	}, TrustKey{
		SchemaVersion: "alica-trust-key/v1",
		Algorithm:     "ed25519",
		KeyID:         keyID,
		PublicKey:     base64.StdEncoding.EncodeToString(publicKey),
	}, nil
}

func TestSignedFixtureAccepted(t *testing.T) {
	manifest, digest, err := LoadAndVerify(fixturePath("d1-contract.manifest.json"), fixturePath("d1-contract.manifest.signature.json"), fixturePath("d1-test-public-key.json"))
	if err != nil {
		t.Fatal(err)
	}
	if digest != "sha256:1bb322baf663684b6d2b9fd831a0e26c03959f5e327dfa5e47f2557f7c1a87c3" {
		t.Fatalf("unexpected digest %s", digest)
	}
	if manifest.ReleaseID == "" || manifest.Installable {
		t.Fatal("fixture identity/eligibility changed")
	}
}

func TestCanonicalJSONIgnoresObjectOrderAndWhitespace(t *testing.T) {
	var left, right any
	if err := decodeStrictGeneric([]byte(`{"b":2,"a":[true,"x"]}`), &left); err != nil {
		t.Fatal(err)
	}
	if err := decodeStrictGeneric([]byte("{\n  \"a\": [true, \"x\"], \"b\": 2\n}"), &right); err != nil {
		t.Fatal(err)
	}
	a, _ := CanonicalJSON(left)
	b, _ := CanonicalJSON(right)
	if string(a) != string(b) || string(a) != `{"a":[true,"x"],"b":2}` {
		t.Fatalf("canonical mismatch: %s / %s", a, b)
	}
}

func TestStrictJSONRejectsDuplicateUnknownFloatAndTrailing(t *testing.T) {
	base, err := os.ReadFile(fixturePath("d1-contract.manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"duplicate":     []byte(strings.Replace(string(base), `"schemaVersion": "alica-release/v1",`, `"schemaVersion": "alica-release/v1", "schemaVersion": "alica-release/v1",`, 1)),
		"unknown":       []byte(strings.Replace(string(base), `"canonicalEncoding":`, `"unknown": true, "canonicalEncoding":`, 1)),
		"float":         []byte(strings.Replace(string(base), `"vcpu": 4`, `"vcpu": 4.0`, 1)),
		"trailing":      append(append([]byte{}, base...), []byte(` {}`)...),
		"invalid UTF-8": append(append([]byte{}, base[:len(base)-2]...), 0xff, '}', '\n'),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "manifest.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if _, _, _, err := LoadManifest(path); err == nil {
				t.Fatal("malformed manifest accepted")
			}
		})
	}
}

func TestTamperAndWrongKeyRejected(t *testing.T) {
	raw, _ := os.ReadFile(fixturePath("d1-contract.manifest.json"))
	tampered := strings.Replace(string(raw), `"releaseVersion": "1.0.0-d1.fixture.1"`, `"releaseVersion": "1.0.0-d1.fixture.2"`, 1)
	path := filepath.Join(t.TempDir(), "tampered.json")
	_ = os.WriteFile(path, []byte(tampered), 0600)
	if _, _, err := LoadAndVerify(path, fixturePath("d1-contract.manifest.signature.json"), fixturePath("d1-test-public-key.json")); err == nil {
		t.Fatal("tampered manifest accepted")
	}
	seed := sha256.Sum256([]byte("wrong key"))
	private := ed25519.NewKeyFromSeed(seed[:])
	_, key, err := signForTest(fixturePath("d1-contract.manifest.json"), "wrong", private)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(key)
	keyPath := filepath.Join(t.TempDir(), "wrong.json")
	_ = os.WriteFile(keyPath, encoded, 0600)
	if _, _, err := LoadAndVerify(fixturePath("d1-contract.manifest.json"), fixturePath("d1-contract.manifest.signature.json"), keyPath); err == nil {
		t.Fatal("wrong key accepted")
	}
}

func TestManifestPolicyMutationsRejected(t *testing.T) {
	manifest, _, _, err := LoadManifest(fixturePath("d1-contract.manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	clone := func() *Manifest {
		raw, _ := json.Marshal(manifest)
		var result Manifest
		_ = json.Unmarshal(raw, &result)
		return &result
	}
	cases := map[string]func(*Manifest){
		"central dependency": func(m *Manifest) { m.Product.CentralRuntime = []string{"psi"} },
		"profile drift":      func(m *Manifest) { m.Product.Profile = "dsh-standard/v1" },
		"EULA drift":         func(m *Manifest) { m.Product.EULADigest = "sha256:" + strings.Repeat("0", 64) },
		"missing component":  func(m *Manifest) { m.Components = m.Components[1:] },
		"tag artifact":       func(m *Manifest) { m.Components[0].Artifact = "oci://registry.fixture.invalid/alica/caddy:latest" },
		"credential artifact": func(m *Manifest) {
			m.Components[0].Artifact = "oci://user:pass@registry.fixture.invalid/caddy@" + m.Components[0].Digest
		},
		"path traversal artifact": func(m *Manifest) {
			m.Components[0].Artifact = "file://bundle/../caddy@" + m.Components[0].Digest
		},
		"unknown network": func(m *Manifest) {
			m.Topology.Containers[0].Networks = append(m.Topology.Containers[0].Networks, "rogue")
		},
		"secret value": func(m *Manifest) { m.SecretRequirements[0].Reference = "secret://cell/db?password=value" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			candidate := clone()
			mutate(candidate)
			if errors := ValidateManifest(candidate); len(errors) == 0 {
				t.Fatal("policy mutation accepted")
			}
		})
	}
}

func TestVersionRanges(t *testing.T) {
	r := VersionRange{MinimumInclusive: "28.4.0", MaximumExclusive: "29.0.0"}
	for value, expected := range map[string]bool{"28.4.0": true, "28.9.9": true, "28.3.9": false, "29.0.0": false, "garbage": false} {
		if actual := VersionInRange(value, r); actual != expected {
			t.Fatalf("%s: got %v", value, actual)
		}
	}
}
