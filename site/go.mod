module gitlab.com/un/itu/genie-ai/site

go 1.26.0

// Docsy /theme subpath.  The subpath only exists on the main branch (no release
// tag ships a theme/ subdirectory), so we pin a pseudo-version.
//
// Pinned to commit cfc902046af7 (2026-05-31), the last commit before Docsy
// raised its min Hugo version to 0.158.0 in 5c5733d (2026-06-11).  Our installed
// Hugo is 0.154.5; this commit declares min_version = "0.146.0" in theme.toml.
// If Hugo is upgraded to >= 0.158.0, this can move to @latest.
require github.com/google/docsy/theme v0.0.0-20260531183939-cfc902046af7 // indirect
