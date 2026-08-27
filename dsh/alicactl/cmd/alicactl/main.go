package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/contract"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
)

const version = "1.0.0-d1"

type options struct {
	manifest    string
	signature   string
	publicKey   string
	root        string
	observation string
	json        bool
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return 2
	}
	if args[0] == "version" {
		fmt.Fprintf(stdout, "alicactl %s\n", version)
		return 0
	}
	if args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		usage(stdout)
		return 0
	}
	if args[0] != "preflight" && args[0] != "status" && args[0] != "verify" {
		fmt.Fprintf(stderr, "alicactl: unknown command %q\n", args[0])
		usage(stderr)
		return 2
	}
	command := args[0]
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(stderr)
	opts := options{root: "/"}
	flags.StringVar(&opts.manifest, "manifest", "", "whole-Cell release manifest JSON")
	flags.StringVar(&opts.signature, "signature", "", "detached manifest signature envelope JSON")
	flags.StringVar(&opts.publicKey, "public-key", "", "pinned Ed25519 trust key JSON")
	flags.StringVar(&opts.root, "root", "/", "host root to inspect read-only")
	flags.StringVar(&opts.observation, "observation", "", "deterministic observation fixture (test mode only)")
	flags.BoolVar(&opts.json, "json", false, "emit JSON report")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "alicactl: positional arguments are forbidden")
		return 2
	}
	if err := validateOptions(opts); err != nil {
		fmt.Fprintf(stderr, "alicactl: %v\n", err)
		return 2
	}
	manifest, digest, err := contract.LoadAndVerify(opts.manifest, opts.signature, opts.publicKey)
	if err != nil {
		fmt.Fprintf(stderr, "alicactl: manifest trust rejected: %v\n", err)
		return 2
	}
	observation, err := lifecycle.Observe(opts.root, manifest, opts.observation)
	if err != nil {
		fmt.Fprintf(stderr, "alicactl: observation failed: %v\n", err)
		return 2
	}
	report := lifecycle.Evaluate(command, manifest, digest, observation)
	if opts.json {
		encoded, _ := json.MarshalIndent(report, "", "  ")
		fmt.Fprintln(stdout, string(encoded))
	} else {
		printHuman(stdout, report)
	}
	if report.Status == "FAIL" {
		return 3
	}
	return 0
}

func validateOptions(opts options) error {
	if opts.manifest == "" || opts.signature == "" || opts.publicKey == "" {
		return errors.New("--manifest, --signature and --public-key are required")
	}
	if !filepath.IsAbs(opts.root) {
		return errors.New("--root must be absolute")
	}
	root, err := filepath.Abs(opts.root)
	if err != nil || filepath.Clean(root) != root {
		return errors.New("--root is invalid")
	}
	for name, value := range map[string]string{"manifest": opts.manifest, "signature": opts.signature, "public-key": opts.publicKey} {
		if value == "" || len(value) > 4096 {
			return fmt.Errorf("--%s is invalid", name)
		}
	}
	return nil
}

func printHuman(writer io.Writer, report lifecycle.Report) {
	fmt.Fprintf(writer, "alicactl %s: %s\n", report.Command, report.Status)
	fmt.Fprintf(writer, "release: %s\nmanifest: %s\nmutation_performed: false\n", report.ReleaseID, report.ManifestDigest)
	if report.CellID != nil {
		fmt.Fprintf(writer, "cell: %s\n", *report.CellID)
	}
	for _, check := range report.Checks {
		fmt.Fprintf(writer, "[%s] %s %s — %s\n", check.Status, check.Name, check.Code, check.Detail)
	}
	for _, drift := range report.Drift {
		fmt.Fprintf(writer, "[DRIFT] %s %s expected=%q observed=%q\n", drift.Class, drift.Resource, drift.Expected, drift.Observed)
	}
	fmt.Fprintf(writer, "summary: passed=%d failed=%d drift=%d\n", report.Summary.Passed, report.Summary.Failed, report.Summary.Drift)
}

func usage(writer io.Writer) {
	fmt.Fprintln(writer, `Usage:
  alicactl version
  alicactl preflight --manifest FILE --signature FILE --public-key FILE [--root /] [--json]
  alicactl status    --manifest FILE --signature FILE --public-key FILE [--root /] [--json]
  alicactl verify    --manifest FILE --signature FILE --public-key FILE [--root /] [--json]

D1 commands are strictly read-only. --observation is accepted only when ALICACTL_TEST_MODE=1.`)
}
