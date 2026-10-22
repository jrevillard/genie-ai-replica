package command

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"

	"gitlab.com/gitlab-org/security-products/analyzers/common/v3/cacert"
	"gitlab.com/gitlab-org/security-products/analyzers/common/v3/pathfilter"
	"gitlab.com/gitlab-org/security-products/analyzers/common/v3/search"
	"gitlab.com/gitlab-org/security-products/analyzers/report/v6"
)

const (
	// ArtifactNameSAST holds the default name for SAST tool report file.
	ArtifactNameSAST = "gl-sast-report.json"
	// ArtifactNameDependencyScanning holds the default name for Dependency Scanning tool report file.
	ArtifactNameDependencyScanning = "gl-dependency-scanning-report.json"
	// ArtifactNameContainerScanning holds the default name for Container Scanning tool report file.
	ArtifactNameContainerScanning = "gl-container-scanning-report.json"
	// ArtifactNameSecretDetection holds the default name for Secret Detection tool report file.
	ArtifactNameSecretDetection = "gl-secret-detection-report.json"
	// ArtifactNameClusterImageScanning hold the default name for the Cluster Image Scanning report file.
	ArtifactNameClusterImageScanning = "gl-cluster-image-scanning-report.json"

	// EnvVarIndentReport is the env var (without prefix) for enabling/disabling indentation
	EnvVarIndentReport = "ANALYZER_INDENT_REPORT"
	// EnvVarOptimizeReport is the env var (without prefix) for enabling/disabling optimization
	EnvVarOptimizeReport = "ANALYZER_OPTIMIZE_REPORT"
	// EnvVarTargetDir is the env var (without prefix) for setting the analyzer target directory.
	EnvVarTargetDir = "ANALYZER_TARGET_DIR"
	// EnvVarArtifactDir is the env var (without prefix) for setting the analyzer artifacts directory.
	EnvVarArtifactDir = "ANALYZER_ARTIFACT_DIR"
	// EnvVarCIProjectDir is the env var that holds the project dir path
	// and usually is propagated from GitLab Runner. It's used as
	// default value for target directory and artifact directory in case
	// EnvVarTargetDir or EnvVarArtifactDir are not set.
	EnvVarCIProjectDir = "CI_PROJECT_DIR"

	flagTargetDir   = "target-dir"
	flagArtifactDir = "artifact-dir"
	flagIndent      = "indent"
	flagOptimize    = "optimize"
)

// Run returns a cli sub-command that implements the full analyzer execution cycle.
func Run(analyzer Analyzer) *cli.Command {
	flags := []cli.Flag{
		&cli.StringFlag{
			Name:    flagTargetDir,
			Usage:   "Target directory",
			EnvVars: []string{EnvVarTargetDir, EnvVarCIProjectDir},
		},
		&cli.StringFlag{
			Name:    flagArtifactDir, // #nosec
			Usage:   "Artifact directory",
			EnvVars: []string{EnvVarArtifactDir, EnvVarCIProjectDir},
		},
		&cli.BoolFlag{
			Name:    flagIndent, // #nosec
			Usage:   "indent",
			EnvVars: []string{EnvVarIndentReport},
			Value:   false,
		},
		&cli.BoolFlag{
			Name:    flagOptimize, // #nosec
			Usage:   "optimize",
			EnvVars: []string{EnvVarOptimizeReport},
			Value:   true,
		},
	}

	flags = append(flags, cacert.NewFlags()...)
	flags = append(flags, search.NewFlags()...)
	flags = append(flags, analyzer.Flags()...)

	// Artifact name defaults to the name of SAST artifacts
	// to ensure backward compatibility with existing SAST analyzers.
	// There's no NewConfig() function so this is the best place to put it.
	artifactName := analyzer.GeneratedArtifactName()
	if artifactName == "" {
		artifactName = ArtifactNameSAST
	}

	// HACK: guess prefix for env var based on report file name
	var envPrefix = "SAST_"
	if artifactName == ArtifactNameDependencyScanning {
		envPrefix = "DS_"
	} else if artifactName == ArtifactNameSecretDetection {
		envPrefix = "SECRET_DETECTION_"
	}
	flags = append(flags, pathfilter.MakeFlags(envPrefix)...)

	return &cli.Command{
		Name:    "run",
		Aliases: []string{"r"},
		Usage:   "Run the analyzer on detected project and generate a compatible artifact",
		Flags:   flags,
		Action: func(c *cli.Context) error {
			startTime := report.ScanTime(time.Now())

			// logs all env vars received as command flags at a debug level
			logEnvVars(c)

			// no args
			if c.Args().Present() {
				if err := cli.ShowSubcommandHelp(c); err != nil {
					return err
				}
				return errInvalidArgs
			}

			// import CA bundle
			if err := cacert.Import(c, analyzer.CertOptions()); err != nil {
				return err
			}

			// parse excluded paths
			filter, err := pathfilter.NewFilter(c)
			if err != nil {
				return err
			}

			// search directory
			log.Info("Detecting project")
			root, err := filepath.Abs(c.String(flagTargetDir))
			if err != nil {
				return err
			}

			artifactPath := filepath.Join(root, artifactName)

			analysis := analyzer.NewAnalysis()

			// search
			searchOpts := search.NewOptions(c)
			matchPath, err := search.New(analysis.MatchProject, searchOpts).Run(root)
			if err != nil {
				if e, ok := err.(search.ErrNotFound); ok {
					log.Warn(e)
					return nil
				}

				return err
			}

			// target directory
			var target string
			if analyzer.AnalyzeAllProjects() {
				// analyze the root directory
				log.Info("Analyzer will attempt to analyze all projects in the repository")
				target = root
			} else {
				// analyze the directory where there was a match
				log.Infof("Analyzer found a supported project at path: %q. Files in this path will be scanned.\n", matchPath)
				target, err = filepath.Abs(matchPath)
				if err != nil {
					return err
				}
			}

			r, runErr := runAndReport(c, analysis, target, root)

			addMetaDataFilterAndFinalize(r, analyzer, startTime, filter)

			serializeErr := analysis.Serialize(
				r,
				artifactPath,
				flagPrependPath,
				c.Bool(flagIndent),
				c.Bool(flagOptimize))

			if serializeErr != nil {
				// in case we have two errors runErr and err, we return both
				if runErr != nil {
					return errors.Join(runErr, serializeErr)
				}
				return serializeErr
			}

			return runErr
		},
	}
}

// logs all env vars received as command flags at a debug level
func logEnvVars(c *cli.Context) {
	if log.GetLevel() < log.DebugLevel {
		return
	}

	for _, flag := range c.Command.Flags {
		// cli.DocGenerationFlag contains GetEnvVars, so it has to implement it
		f, ok := flag.(cli.DocGenerationFlag)
		if !ok {
			continue
		}

		// don't log if flag is not visible
		// (if it doesn't implement cli.VisibleFlag, assume it *is* visible)
		if vf, ok := flag.(cli.VisibleFlag); ok {
			if !vf.IsVisible() {
				continue
			}
		}

		// all flags have at least one name, even if just empty string
		names := f.Names()

		// if no env var(s) associated, not printed out
		envVars := f.GetEnvVars()
		if len(envVars) == 0 {
			continue
		}

		// get value as string
		var valStr string
		switch v := c.Value(names[0]).(type) {
		case cli.StringSlice:
			// special case for string slice flags for better format in log
			valStr = strings.Join(v.Value(), ",")
		default:
			// using c.Value(flagname) over f.GetValue() as otherwise value for
			// boolean flags (and possibly others) is not printed
			valStr = fmt.Sprintf("%+v", v)
		}

		log.Debugf("%s=%s", strings.Join(envVars, ","), valStr)
	}
}

func newErrorReport() *report.Report {
	reportWithStatus := report.NewReport()
	reportWithStatus.Scan.Status = report.StatusFailure
	return &reportWithStatus
}

func newSuccessReport() *report.Report {
	reportWithStatus := report.NewReport()
	reportWithStatus.Scan.Status = report.StatusSuccess
	return &reportWithStatus
}

// runAndReport generates and returns a SAST report
// this function always returns a report in failure and success states
func runAndReport(c *cli.Context, analysis Analysis, target string, root string) (*report.Report, error) {
	err := analysis.LoadRuleset(target)
	if err != nil {
		return newErrorReport(), err
	}

	log.Info("Running analyzer")
	f, err := analysis.AnalyzeProject(c, target)
	if err != nil {
		return newErrorReport(), err
	}
	defer f.Close()

	rel, err := filepath.Rel(root, target)
	if err != nil {
		return newErrorReport(), err
	}

	log.Info("Creating report")
	r, err := analysis.ConvertReport(f, rel)
	// some analyzers haven't yet been updated to return a report with an error status when
	// an error occurs, and instead simply return a nil report. In this case, we need to
	// return a non-nil report with an error status
	if r == nil {
		if err != nil {
			return newErrorReport(), err
		}

		// Both the report _and_ error were nil, return an empty report with success status.
		// This situation should never happen, but if it does, the app will panic, which we
		// want to avoid
		return newSuccessReport(), nil
	}

	if err != nil {
		r.Scan.Status = report.StatusFailure
	} else {
		r.Scan.Status = report.StatusSuccess
	}

	return r, err
}

// addMetaDataFilterAndFinalize handles all report processing steps: metadata setup, filtering, and finalization
func addMetaDataFilterAndFinalize(r *report.Report, analyzer Analyzer, startTime report.ScanTime, filter *pathfilter.Filter) {
	endTime := report.ScanTime(time.Now())
	r.Scan.EndTime = &endTime

	// add report metadata
	r.Scan.Analyzer = analyzer.Details()
	r.Scan.Scanner = analyzer.ScannerDetails()
	r.Scan.Type = analyzer.Category()
	r.Scan.StartTime = &startTime

	// filter vulnerabilities, override vulnerability metadata
	r.ExcludePaths(filter.IsExcluded)
	if r.Config.Path != "" {
		r.FilterDisabledRules(&r.Config)
		r.ApplyReportOverrides(&r.Config)
	}

	// finalize report
	r.Sort()
	r.TruncateTextFields()
}
