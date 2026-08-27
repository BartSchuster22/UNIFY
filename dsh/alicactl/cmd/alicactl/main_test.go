package main

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLIReadOnlyCommands(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "1")
	t.Setenv("ALICACTL_NOW", "2026-08-27T21:00:00Z")
	root := filepath.Join("..", "..", "testdata")
	common := []string{"--manifest", filepath.Join(root, "d1-contract.manifest.json"), "--signature", filepath.Join(root, "d1-contract.manifest.signature.json"), "--public-key", filepath.Join(root, "d1-test-public-key.json"), "--observation", filepath.Join(root, "observed-conformant.json"), "--json"}
	for _, command := range []string{"preflight", "status", "verify"} {
		t.Run(command, func(t *testing.T) {
			var out, err bytes.Buffer
			code := run(append([]string{command}, common...), &out, &err)
			if code != 0 || !strings.Contains(out.String(), `"status": "PASS"`) || !strings.Contains(out.String(), `"mutationPerformed": false`) {
				t.Fatalf("code=%d stdout=%s stderr=%s", code, out.String(), err.String())
			}
		})
	}
}
func TestCLIRejectsFixtureOutsideTestMode(t *testing.T) {
	t.Setenv("ALICACTL_TEST_MODE", "")
	root := filepath.Join("..", "..", "testdata")
	var out, err bytes.Buffer
	code := run([]string{"verify", "--manifest", filepath.Join(root, "d1-contract.manifest.json"), "--signature", filepath.Join(root, "d1-contract.manifest.signature.json"), "--public-key", filepath.Join(root, "d1-test-public-key.json"), "--observation", filepath.Join(root, "observed-conformant.json")}, &out, &err)
	if code != 2 || !strings.Contains(err.String(), "ALICACTL_TEST_MODE") {
		t.Fatalf("code=%d err=%s", code, err.String())
	}
}
func TestCLIRejectsMissingTrustInputs(t *testing.T) {
	var out, err bytes.Buffer
	if code := run([]string{"verify"}, &out, &err); code != 2 {
		t.Fatalf("code=%d", code)
	}
}
