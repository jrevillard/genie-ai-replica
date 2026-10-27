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

Ports on both sides are compared in POD space, i.e. after DNAT — the space
the datapath actually evaluates. A policy may be written against either
space, so every declared port is translated through the peer's own Service
(`index_services`); without that, the common case of a source naming the
Service port and the destination naming the container port reports a broken
flow that does not exist, and a policy naming the Service port where the pod
port is required goes unnoticed.

What it does NOT cover, by construction:

  * Flows to operator-managed peers. The check needs a policy on BOTH
    ends, and vm-operator / kube-arangodb / keycloak-operator pods have
    none — the chart only restricts the pods it owns. A peer labelled
    `app.kubernetes.io/instance: vmetrics` or
    `app.kubernetes.io/managed-by: keycloak-operator` is therefore out of
    scope, and that is exactly where the collector's egress to
    VictoriaMetrics (Service 8428, pod 8429) hid: correct-looking, wrong
    post-DNAT, and silently dropping every remote-write batch.
  * A rule that mixes a CIDR or namespace peer with a component peer. The
    CIDR says nothing about which component is meant, so those rules are
    reported as SKIPPED rather than checked — visible, not silently green.
  * Anything a Service-less peer implies (a pod dialled directly by IP).

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
    """Ports a single rule covers. `endPort` expands into the whole range.

    A rule with NO `ports:` block declares EVERY port and returns None —
    the same signal an entry without `port` carries. Returning an empty
    set here made the whole any-port class invisible: no flow was ever
    declared for a port-less rule, so it was neither asserted nor
    reported."""
    entries = rule.get("ports")
    if entries is None:
        return None
    covered = set()
    for entry in entries:
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
    """True when `covered` admits the declared flow's port.

    `port=None` (a rule with no `ports:`) is the hard case: it declares
    EVERY port, and no finite destination set admits every port. The
    first version of this fix returned True against any non-empty set —
    which silently permitted a source rule whose every-port declaration
    the destination answers on exactly one port. The flow is neither
    cleanly permitted nor cleanly blocked: the caller treats
    (None, concrete set) as ADVISORY and says so."""
    if covered is None:
        return True
    if port is None:
        return False
    return port in covered


def admitted_ports(policies, component, direction, peer_component, services):
    """Union of the ports the component's matching rules admit for the
    peer, or None when no rule with a peer match carries concrete ports
    (the case covers() already judged)."""
    key = "to" if direction == "egress" else "from"
    port_space = peer_component if direction == "egress" else component
    admitted: set[int] = set()
    matched = False
    for policy in policies.get(component, []):
        for rule in (policy.get("spec") or {}).get(direction) or []:
            if is_unscoped_rule(rule, key) or not peer_allows_any(rule, key, peer_component):
                continue
            matched = True
            covered = to_pod_ports(rule_ports(rule), services, port_space)
            if covered:
                admitted.update(covered)
    return sorted(admitted) if matched and admitted else None


def partial_admission(covered, port):
    """The (any-port flow, concrete destination set) case covers() cannot
    judge: neither True (only some ports are admitted) nor a useful
    False (the ports the deployment actually dials may be among them).
    Returns the admitted ports for the advisory line, or None when the
    case does not apply."""
    if port is None and covered:
        return sorted(covered)
    return None


def component_of(selector):
    """The component label a `podSelector` targets, if it names one.

    Two label shapes name chart-owned components in this chart's renders:
    `genieai.io/component` (services, orchestrators, hooks) and the bare
    `app` (the four in-cluster model Deployments and their policies). The
    operator-stamped peers (`app.kubernetes.io/instance: vmetrics`,
    `app.kubernetes.io/managed-by: keycloak-operator`, the Envoy data
    plane's `app.kubernetes.io/component: proxy`) match NEITHER key and
    stay out of scope — they have no policy on both ends by design.
    """
    labels = (selector or {}).get("matchLabels") or {}
    return labels.get("genieai.io/component") or labels.get("app")


def index_services(docs):
    """component -> {service port: container port}, from the rendered Services.

    Both policy sides are evaluated AFTER DNAT, so both describe the
    DESTINATION's container port. The two sides are routinely written in
    different spaces — the backend declares egress to `translation` on
    9031 (the Service port) while the translation policy admits 8888 (the
    container port the Service maps it to) — and comparing them raw
    reports a broken flow where the datapath is fine. Translating every
    declared port through the peer's own Service puts both sides in the
    same space.

    It also sharpens the check: a policy that names the Service port
    where the pod port is required (the collector's egress to
    VictoriaMetrics, 8428 for a pod that listens on 8429) stops matching
    once normalised, which is exactly the defect that rule carried.
    """
    mapping: dict[str, dict] = {}
    for doc in docs:
        if not isinstance(doc, dict) or doc.get("kind") != "Service":
            continue
        # A Service's spec.selector is a FLAT label map, not a
        # LabelSelector — reading it with component_of() (which expects
        # {"matchLabels": ...}) yields nothing and the index stays empty.
        component = (doc.get("spec", {}).get("selector") or {}).get("genieai.io/component")
        if not component:
            continue
        ports = {}
        for entry in doc.get("spec", {}).get("ports") or []:
            if "port" not in entry:
                continue
            service_port = as_port(entry["port"])
            target = entry.get("targetPort", service_port)
            # A NAMED targetPort (the chart's `targetPort: http` style) has
            # no numeric mapping; leave the Service port as-is.
            if isinstance(as_port(target), int):
                ports[service_port] = as_port(target)
        mapping.setdefault(component, {}).update(ports)
    return mapping


def to_pod_ports(covered, services, component):
    """Translate a rule's ports from the peer's Service space to pod space."""
    if covered is None:
        return None
    mapping = services.get(component) or {}
    return {mapping.get(port, port) for port in covered}


def is_unscoped_rule(rule, key):
    """Whether a rule carries a peer that is not component-scoped.

    `ipBlock` (a CIDR) and `namespaceSelector` (a whole namespace) say
    nothing about which component a rule is about, so this script cannot
    reason about them. A rule made ONLY of such peers is simply not
    checkable and that is fine. A rule that mixes one of them with a
    component peer is different: the component peer carries the intent,
    and silently treating the rule as "admits anything" turns the whole
    rule into an unchecked hole — a chart edit that adds an ipBlock next
    to a podSelector would disable the gate for that rule with the
    pipeline still green. Those get reported as skipped instead.
    """
    return any("ipBlock" in peer or "namespaceSelector" in peer for peer in rule.get(key) or [])


def peer_allows_any(rule, key, peer_component):
    """Whether a rule admits `peer_component` at all, ignoring ports."""
    for peer in rule.get(key) or []:
        if "ipBlock" in peer or "namespaceSelector" in peer:
            # Not a component-scoped peer: admissible, because the port
            # matrix (not the selector) is what this script asserts.
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


def policy_allows(policies, component, direction, peer_component, port, services, skipped=None):
    key = "to" if direction == "egress" else "from"
    # Whose Service space is this rule's port list written in? An egress
    # rule names the DESTINATION (its Service ports or its pod ports); an
    # ingress rule names the policy's OWN component. Translating an
    # ingress rule through the SOURCE's mapping — the shape that happens
    # when both sides use the same context — reads a 9031 on a peer whose
    # Service maps 9031->8888 as 8888 and reports a broken flow that does
    # not exist (or, worse, admits one that does).
    port_space = peer_component if direction == "egress" else component
    for policy in policies.get(component, []):
        name = policy.get("metadata", {}).get("name", "?")
        for rule in (policy.get("spec") or {}).get(direction) or []:
            # Both sides are compared against the destination's container
            # port once DNAT has run, so translate this rule's ports out of
            # whatever Service space the author used.
            covered = to_pod_ports(rule_ports(rule), services, port_space)
            if not covers(covered, port):
                continue
            if is_unscoped_rule(rule, key) and skipped is not None:
                # Report the hole rather than pass over it: this rule
                # mixes a CIDR/namespace peer with a component peer, so
                # its component-scoped half is not asserted here. The
                # rule is still treated as admissible below — a CIDR peer
                # may well cover the peer in question, and failing closed
                # on it would report a broken flow where none is known.
                skipped.add(f"{name}/{direction}")
            if peer_allows_any(rule, key, peer_component):
                return True
    return False


def declared_flows(policies, services):
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
                    for port in to_pod_ports(covered, services, target):
                        flows.add((source, target, port))
    # The INGRESS side declares flows too (a destination that admits a
    # source expects that source's egress to allow the connection), but
    # they are NOT asserted here yet: a flow declared only on the
    # ingress side is ambiguous in a chart whose peers exist in two
    # topologies. Measured on this branch: `dataprep -> embedding :6000`
    # and `retriever -> embedding :6000` are real in the in-cluster GPU
    # mode (the embedding Service is the endpoint) and nonexistent in the
    # external mode (the clients dial the GPU node), and
    # `translation -> vllm-translation :8888` names a port the model
    # does not listen on. The in-cluster tier has never been validated
    # on a live cluster (the laptop runs the external mode), so turning
    # those findings into gate failures would ship a red CI on a tier
    # nobody has run. Until that tier is exercised, the ingress-side
    # flows are listed in the ledger (docs/charts/migration-status.md)
    # and the asymmetry is fixed there first.
    return flows


def crosscheck(path):
    with open(path) as handle:
        docs = [d for d in yaml.safe_load_all(handle) if d]
    policies = index_policies(docs)
    services = index_services(docs)
    flows = declared_flows(policies, services)

    blocked = []
    advisory = []
    skipped: set[str] = set()
    for source, target, port in sorted(flows, key=lambda f: (f[0], f[1], str(f[2]))):
        missing = []
        allowed = True
        for side, component, peer in (("egress", source, target), ("ingress", target, source)):
            if policy_allows(policies, component, side, peer, port, services, skipped):
                continue
            # An any-port flow a concrete destination set only partially
            # admits is neither permitted nor broken: the ports the
            # deployment actually dials may be among the admitted ones.
            # Say what IS admitted instead of guessing either way.
            admitted = admitted_ports(policies, component, side, peer, services)
            if admitted is not None:
                advisory.append((source, target, side, admitted))
            else:
                allowed = False
                missing.append(side)
        if not allowed and missing:
            blocked.append((source, target, port, "+".join(missing)))

    print(
        f"{path}: {len(policies)} component policies, "
        f"{len(flows)} declared pod-to-pod flows"
    )
    for entry in sorted(skipped):
        print(f"  SKIPPED {entry}: mixes a CIDR/namespace peer with a component peer — not asserted here")
    for source, target, port, missing in blocked:
        shown = port if port is not None else "any"
        print(
            f"  BLOCKED {source} -> {target} :{shown} ({missing} not permitted by the destination/source policy)"
        )
    for source, target, side, admitted in advisory:
        print(
            f"  ADVISORY {source} -> {target} :any — the {side} side admits only {admitted}; "
            "the flow is declared port-less, so verify the dialed port is among them "
            "(an any-port flow cannot be fully asserted against a port-specific peer)."
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