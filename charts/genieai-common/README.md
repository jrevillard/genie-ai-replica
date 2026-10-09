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
    {{- include "genieai-common.labels" . | nindent 4 }}
```

### Values scope

`nameOverride`, `fullnameOverride` and `component` are read from the
**consuming chart's root values** (helpers render with the parent's
context). Setting them under a `genieai-common:` subtree in values.yaml is
silently ignored — always place them at the root.

## Why `type: library`?

Library charts do not render Pods/Services themselves — they export helpers and
values consumed by umbrella templates. The umbrella chart is what users install.
