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
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/install"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/lifecycle"
)

const version = "1.0.0-d3"

type options struct {
	manifest    string
	signature   string
	publicKey   string
	root        string
	observation string
	request     string
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
	if args[0] != "preflight" && args[0] != "status" && args[0] != "verify" && args[0] != "plan" && args[0] != "install" {
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
	flags.StringVar(&opts.request, "request", "", "closed unified clean-install request JSON")
	flags.BoolVar(&opts.json, "json", false, "emit JSON report")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "alicactl: positional arguments are forbidden")
		return 2
	}
	if (command == "plan" || command == "install") && opts.request == "" {
		fmt.Fprintln(stderr, "alicactl: --request is required for plan and install")
		return 2
	}
	if command != "plan" && command != "install" && opts.request != "" {
		fmt.Fprintln(stderr, "alicactl: --request is accepted only by plan and install")
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
	if command == "plan" || command == "install" {
		request, requestErr := install.LoadRequest(opts.request)
		if requestErr != nil {
			fmt.Fprintf(stderr, "alicactl: request rejected: %v\n", requestErr)
			return 2
		}
		installer, installErr := install.New(manifest, digest, request)
		if installErr != nil {
			fmt.Fprintf(stderr, "alicactl: installation rejected: %v\n", installErr)
			return 2
		}
		var result install.Result
		if command == "plan" {
			result, installErr = installer.Plan()
		} else {
			result, installErr = installer.Install()
		}
		if installErr != nil {
			fmt.Fprintf(stderr, "alicactl: %s failed: %v\n", command, installErr)
			return 3
		}
		encoded, _ := json.MarshalIndent(result, "", "  ")
		fmt.Fprintln(stdout, string(encoded))
		return 0
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
	if len(opts.request) > 4096 {
		return errors.New("--request is invalid")
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
  alicactl plan      --manifest FILE --signature FILE --public-key FILE --request FILE
  alicactl install   --manifest FILE --signature FILE --public-key FILE --request FILE

D1 inspection commands remain strictly read-only. D2 plan is read-only; D2 install is the single transactional clean-install writer. --observation is accepted only when ALICACTL_TEST_MODE=1.`)
}
