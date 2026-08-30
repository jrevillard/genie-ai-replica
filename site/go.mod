module gitlab.com/un/itu/genie-ai/site

go 1.26.0

// Docsy is imported via its /theme subpath, which has no release tags.
// This pseudo-version pins commit cfc902046af7 (requires Hugo >= 0.146.0).
// The latest /theme HEAD needs Hugo >= 0.158, which hugomods/hugo:exts (CI image)
// does not ship yet; bump this pin once the CI image provides Hugo >= 0.158.
require github.com/google/docsy/theme v0.0.0-20260531183939-cfc902046af7 // indirect
