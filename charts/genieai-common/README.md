# genieai-common

Library chart for the GENIE.AI Helm umbrella. Provides:

- Naming helpers (`genieai-common.name`, `genieai-common.fullname`)
- Label selectors (`genieai-common.labels`, `genieai-common.selectorLabels`)
- Chart/version label (`genieai-common.chart`)

## Usage

Consume from an umbrella chart's `Chart.yaml`:

```yaml
dependencies:
  - name: genieai-common
    version: "0.1.0"
    repository: "file://../genieai-common"
```

No `import-values` is needed: template definitions defined by a library chart
are directly callable from the consuming chart's templates.

Then in templates:

```gotemplate
metadata:
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" .Values "component" "my-component") | nindent 4 }}
```

(The shorthand `include "genieai-common.labels" .` is the ad-hoc fallback —
it works because the helper reads `component` from `.Values` as a default,
but every shipped call site in the umbrella chart uses the explicit
dict form above so the per-template component lands in both component
labels.)

### Values scope

`nameOverride` and `fullnameOverride` are read from the **consuming chart's
root values** (helpers render with the parent's context). Setting them under
a `genieai-common:` subtree in values.yaml is silently ignored — always place
them at the root. `component` is a values key (defaulted to `"umbrella"` in
the schema) but is **only** a fallback for ad-hoc callers: call sites pass
the per-template component name in the context dict — `(dict "Chart" .Chart
"Release" .Release "Values" .Values "component" <name>)` — and the helper
emits both `app.kubernetes.io/component` and `genieai.io/component` from
that single value. Do not pass the component via `--set`: the per-call
dict value takes precedence, and a top-level `--set component=...`
would never reach resource labels.

## Why `type: library`?

Library charts do not render Pods/Services themselves — they export helpers and
values consumed by umbrella templates. The umbrella chart is what users install.
