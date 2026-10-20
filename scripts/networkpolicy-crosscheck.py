#!/usr/bin/env python3
"""Cross-check the chart's NetworkPolicies against each other.

Why this exists
---------------
Every NetworkPolicy in the chart selects a pod component and renders BOTH
an `egress` (what that component may dial) and an `ingress` (what may dial
it) side. The two sides live in different templates and are edited
independently, so a flow declared on one side is routinely absent from the
other: the policy renders fine, `helm lint` is green, kubeconform is happy,
and the only symptom is a pod that times out against a Service that exists.

Nothing else in the pipeline catches it. kubeconform validates schema, not
reachability. A cluster-level smoke test would catch it — but only on a CNI
that actually enforces NetworkPolicy (minikube's default kubenet and kind's
default CNI store the objects and drop them; Calico, Cilium and kube-router
apply them), so a laptop cluster can look perfectly healthy while carrying a
completely broken egress graph.

The model
---------
NetworkPolicy egress `to` names the DESTINATION; ingress `from` names the
SOURCE. So a flow S -> D on port P is permitted only if BOTH hold:

  * the source component's policy admits egress to D on P, AND
  * the destination component's policy admits ingress from S on P.

This script collects every pod-to-pod flow the policies DECLARE (source
egress to a `podSelector` that names a component some other policy also
selects) and reports the ones the destination never allows back. Declaring a
flow and admitting it are different decisions; the first is the intent, the
second is what the datapath honours.

Usage:
  networkpolicy-crosscheck.py RENDERED.yaml [RENDERED.yaml ...]

Exits non-zero and prints one `BLOCKED src -> dst :port (side missing)` line
per broken flow. A render with no declared pod-to-pod flows is reported and
passes — there is nothing to contradict.
"""

import re
import sys

import yaml

# Ports are compared as ints where possible; named ports are left as strings
# so they never accidentally match a numeric peer port.
_PORT = re.compile(r"^\d+$")


def as_port(value):
    if value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value)
    return int(text) if _PORT.match(text) else text


def rule_ports(rule):
    """Ports a single rule covers. `endPort` expands into the whole range."""
    covered = set()
    for entry in rule.get("ports") or []:
        if "port" not in entry:
            # A rule entry with no `port` at all means "every port".
            return None
        low = as_port(entry["port"])
        high = as_port(entry["endPort"]) if "endPort" in entry else low
        if isinstance(low, int) and isinstance(high, int):
            covered.update(range(low, high + 1))
        else:
            covered.add(low)
            if high is not None and high != low:
                covered.add(high)
    return covered


def covers(covered, port):
    if covered is None:
        return True
    if port is None:
        return False
    return port in covered


def component_of(selector):
    """The component label a `podSelector` targets, if it names one."""
    labels = (selector or {}).get("matchLabels") or {}
    return labels.get("genieai.io/component")


def peer_allows_any(rule, key, peer_component):
    """Whether a rule admits `peer_component` at all, ignoring ports."""
    for peer in rule.get(key) or []:
        if "ipBlock" in peer or "namespaceSelector" in peer:
            # Not a component-scoped peer: treated as admissible, because the
            # port matrix (not the selector) is what this script asserts.
            return True
        selector = peer.get("podSelector")
        if selector is not None:
            # An EMPTY podSelector matches every pod in the namespace, the
            # peer included — the documented "open within the release" form.
            if not (selector.get("matchLabels") or {}):
                return True
            if component_of(selector) == peer_component:
                return True
    return False


def index_policies(docs):
    policies = {}
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") != "NetworkPolicy":
            continue
        spec = doc.get("spec") or {}
        component = component_of(spec.get("podSelector"))
        if not component:
            # A policy selecting by app.kubernetes.io/* alone (operator pods)
            # carries no component identity to cross-check against.
            continue
        policies.setdefault(component, []).append(doc)
    return policies


def policy_allows(policies, component, direction, peer_component, port):
    key = "to" if direction == "egress" else "from"
    for policy in policies.get(component, []):
        for rule in (policy.get("spec") or {}).get(direction) or []:
            if not covers(rule_ports(rule), port):
                continue
            if peer_allows_any(rule, key, peer_component):
                return True
    return False


def declared_flows(policies):
    flows = set()
    for source, source_policies in policies.items():
        for policy in source_policies:
            for rule in (policy.get("spec") or {}).get("egress") or []:
                covered = rule_ports(rule)
                for peer in rule.get("to") or []:
                    target = component_of(peer.get("podSelector"))
                    if not target or target not in policies:
                        continue
                    if covered is None:
                        flows.add((source, target, None))
                        continue
                    for port in covered:
                        flows.add((source, target, port))
    return flows


def crosscheck(path):
    with open(path) as handle:
        docs = [d for d in yaml.safe_load_all(handle) if d]
    policies = index_policies(docs)
    flows = declared_flows(policies)

    blocked = []
    for source, target, port in sorted(flows, key=lambda f: (f[0], f[1], str(f[2]))):
        missing = []
        if not policy_allows(policies, source, "egress", target, port):
            missing.append("egress")
        if not policy_allows(policies, target, "ingress", source, port):
            missing.append("ingress")
        if missing:
            blocked.append((source, target, port, "+".join(missing)))

    print(
        f"{path}: {len(policies)} component policies, "
        f"{len(flows)} declared pod-to-pod flows"
    )
    for source, target, port, missing in blocked:
        print(
            f"  BLOCKED {source} -> {target} :{port} ({missing} not permitted by the destination/source policy)"
        )
    return policies, blocked


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    blocked = []
    empty = []
    for path in argv[1:]:
        policies, found = crosscheck(path)
        blocked.extend(found)
        if not policies:
            empty.append(path)
    if empty:
        print(
            f"\nNo component-scoped NetworkPolicy found in: {', '.join(empty)}\n"
            "A render that carries no policy proves nothing. This happens when\n"
            "the render dropped the tier that owns them (or when the policy\n"
            "templates stopped matching) — treat it as a failure, not a pass."
        )
        return 1
    if blocked:
        print(
            f"\n{len(blocked)} NetworkPolicy flow(s) are declared on one side and "
            "denied on the other. Kubernetes applies ingress and egress as "
            "separate policies and admits only what BOTH allow, so each of "
            "these is a connection that silently times out at runtime."
        )
        return 1
    print("all declared pod-to-pod flows are permitted by both sides")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))