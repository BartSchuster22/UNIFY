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
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/recovery"
	"github.com/alica-ltd/alica-community-dsh/alicactl/internal/update"
)

const version = "1.0.0-d5"

type options struct {
	manifest       string
	signature      string
	publicKey      string
	root           string
	observation    string
	request        string
	backupID       string
	syntheticAlert bool
	json           bool
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
	if args[0] != "preflight" && args[0] != "status" && args[0] != "verify" && args[0] != "plan" && args[0] != "install" && args[0] != "update-plan" && args[0] != "update" && args[0] != "backup" && args[0] != "restore" && args[0] != "restart" && args[0] != "operations-check" {
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
	flags.StringVar(&opts.request, "request", "", "closed command request JSON")
	flags.StringVar(&opts.backupID, "backup-id", "", "typed backup identity required for restore")
	flags.BoolVar(&opts.syntheticAlert, "synthetic-alert", false, "deliver a synthetic operations alert (test mode only)")
	flags.BoolVar(&opts.json, "json", false, "emit JSON report")
	if err := flags.Parse(args[1:]); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "alicactl: positional arguments are forbidden")
		return 2
	}
	installationCommand := command == "plan" || command == "install"
	updateCommand := command == "update-plan" || command == "update"
	recoveryCommand := command == "backup" || command == "restore" || command == "restart" || command == "operations-check"
	if (installationCommand || updateCommand || recoveryCommand) && opts.request == "" {
		fmt.Fprintln(stderr, "alicactl: --request is required for this command")
		return 2
	}
	if !installationCommand && !updateCommand && !recoveryCommand && opts.request != "" {
		fmt.Fprintln(stderr, "alicactl: --request is not accepted by this command")
		return 2
	}
	if !recoveryCommand && (opts.backupID != "" || opts.syntheticAlert) {
		fmt.Fprintln(stderr, "alicactl: recovery flags are not accepted by this command")
		return 2
	}
	if recoveryCommand && command != "restore" && opts.backupID != "" {
		fmt.Fprintln(stderr, "alicactl: --backup-id is accepted only by restore")
		return 2
	}
	if recoveryCommand && command != "operations-check" && opts.syntheticAlert {
		fmt.Fprintln(stderr, "alicactl: --synthetic-alert is accepted only by operations-check")
		return 2
	}
	if recoveryCommand {
		request, requestErr := recovery.LoadRequest(opts.request)
		if requestErr != nil {
			fmt.Fprintf(stderr, "alicactl: request rejected: %v\n", requestErr)
			return 2
		}
		if opts.backupID != "" {
			request.BackupID = opts.backupID
		}
		manager, managerErr := recovery.New(request)
		if managerErr != nil {
			fmt.Fprintf(stderr, "alicactl: operations rejected: %v\n", managerErr)
			return 2
		}
		var value any
		switch command {
		case "backup":
			value, managerErr = manager.Backup()
		case "restore":
			value, managerErr = manager.Restore()
		case "restart":
			value, managerErr = manager.Restart()
		case "operations-check":
			if opts.syntheticAlert && os.Getenv("ALICACTL_OPERATIONS_TEST_MODE") != "1" {
				fmt.Fprintln(stderr, "alicactl: synthetic alert is test-mode-only")
				return 2
			}
			value, managerErr = manager.OperationsCheck(opts.syntheticAlert)
		}
		if managerErr != nil {
			fmt.Fprintf(stderr, "alicactl: %s failed: %v\n", command, managerErr)
			return 3
		}
		encoded, _ := json.MarshalIndent(value, "", "  ")
		fmt.Fprintln(stdout, string(encoded))
		return 0
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
	if installationCommand {
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
	if updateCommand {
		request, requestErr := update.LoadRequest(opts.request)
		if requestErr != nil {
			fmt.Fprintf(stderr, "alicactl: request rejected: %v\n", requestErr)
			return 2
		}
		manager, updateErr := update.New(manifest, digest, opts.manifest, opts.signature, opts.publicKey, request)
		if updateErr != nil {
			fmt.Fprintf(stderr, "alicactl: update rejected: %v\n", updateErr)
			return 2
		}
		var result update.Result
		if command == "update-plan" {
			result, updateErr = manager.Plan()
		} else {
			result, updateErr = manager.Apply()
		}
		if updateErr != nil {
			fmt.Fprintf(stderr, "alicactl: %s failed: %v\n", command, updateErr)
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
  alicactl update-plan --manifest FILE --signature FILE --public-key FILE --request UPDATE.json
  alicactl update      --manifest FILE --signature FILE --public-key FILE --request UPDATE.json
  alicactl backup    --request RECOVERY.json
  alicactl restore   --request RECOVERY.json --backup-id bak_UUID7
  alicactl restart   --request RECOVERY.json
  alicactl operations-check --request RECOVERY.json [--synthetic-alert]

D1 inspection commands remain strictly read-only. D2 install owns clean installation. D4 owns recovery and operations. D5 owns manually approved candidate-channel updates with threshold trust, exact directional compatibility, mandatory off-host backup and atomic accepted-current mutation. --observation and --synthetic-alert are test-mode-only.`)
}
