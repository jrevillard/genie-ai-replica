#!/usr/bin/env python3
"""Relay a local port to the laptop cluster's edge nodePort.

WHY: the E2E suite must not reach the cluster through
`kubectl port-forward`. Every forwarded connection negotiates a SPDY
stream THROUGH THE API SERVER, and under the suite's own connection
churn that negotiation times out mid-run: the listener stays alive but
the tunnel is dead, and every later goto against `networkidle` fails in
a cascade that looks like a test defect. The nodePort goes through the
data plane instead — no API server in the path.

WHAT it solves that a port-forward does not: the nodePort's NUMBER.
The suite's origin must stay `https://<host>:4443` — the realm's
redirectUris and the frontend's baked issuer are pinned to it, and any
other port breaks the OIDC redirect, not the tests. The cluster's edge
listens on a nodePort whose number changes with every install (30654 /
30356 / 31736 depending on the release), so the suite's origin port and
the cluster's nodePort are two different numbers on purpose. This relay
is the adapter between them: it accepts 127.0.0.1:4443 and forwards to
the nodePort.

The suite also needs the NAME to resolve. The relay listens on the
loopback address, so `E2E_VENUE_IP=127.0.0.1` (plus
`E2E_VENUE_HOST` when the venue's host differs from the BASE_URL host)
maps the venue's name for BOTH resolvers, Node and Chromium — see
tests/e2e/helpers/venue-launch-args.js.

USAGE:
  scripts/laptop-edge-relay.py [host] [port]

Both are OPTIONAL: with no argument the relay asks the cluster itself
(`minikube ip` for the address, the Envoy Service's `https` nodePort
for the port), so the recipe never carries a number that went stale.
An explicit host/port overrides the lookup — that is the path for a
venue that is not the local minikube.

  python3 scripts/laptop-edge-relay.py
  BASE_URL=https://genieai.local:4443 E2E_VENUE_IP=127.0.0.1 \\
    npx playwright test tests/e2e/

Exit codes: 0 = the relay ended cleanly; 1 = the target could not be
resolved (the message names what was looked up and where).
"""

import asyncio
import contextlib
import shutil
import subprocess
import sys

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 4443
# The Envoy data-plane Service carries a hash suffix (envoy-genieai-
# genieai-<hash>), so it is addressed by its labels, not by name.
ENVOY_SERVICE_SELECTOR = (
    "app.kubernetes.io/component=proxy,"
    "gateway.envoyproxy.io/owning-gateway-name=genieai"
)


def minikube_ip():
    """The node's address, as minikube reports it."""
    binary = shutil.which("minikube")
    if not binary:
        raise SystemExit(
            "minikube is not on PATH — pass the edge address explicitly: "
            "scripts/laptop-edge-relay.py <host> <nodePort>"
        )
    out = subprocess.run(
        [binary, "ip"], capture_output=True, text=True, check=True
    ).stdout.strip()
    if not out:
        raise SystemExit(
            "minikube ip answered nothing — is the cluster running? "
            "Pass the edge address explicitly: "
            "scripts/laptop-edge-relay.py <host> <nodePort>"
        )
    return out


def envoy_node_port():
    """The Envoy data-plane Service's HTTPS nodePort."""
    out = subprocess.run(
        [
            "kubectl",
            "-n",
            "genieai",
            "get",
            "svc",
            "-l",
            ENVOY_SERVICE_SELECTOR,
            "-o",
            "jsonpath={.items[0].spec.ports[?(@.port==4443)].nodePort}",
        ],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if not out:
        raise SystemExit(
            "the Envoy Service's https nodePort was not found in the genieai "
            "namespace — is the release installed? Pass the port explicitly: "
            "scripts/laptop-edge-relay.py <host> <nodePort>"
        )
    return int(out)


async def pipe(reader, writer):
    """One direction of the tunnel."""
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
        pass
    finally:
        with contextlib.suppress(OSError):
            writer.close()


async def handle(client_reader, client_writer):
    """One accepted connection, pumped both ways."""
    try:
        server_reader, server_writer = await asyncio.open_connection(*TARGET)
    except OSError:
        client_writer.close()
        return
    await asyncio.gather(
        pipe(client_reader, server_writer),
        pipe(server_reader, client_writer),
    )


async def main():
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    print(
        f"relaying {LISTEN_HOST}:{LISTEN_PORT} -> {TARGET[0]}:{TARGET[1]} "
        f"(set E2E_VENUE_IP={LISTEN_HOST} so the venue's name resolves here)",
        flush=True,
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) == 3:
        TARGET = (sys.argv[1], int(sys.argv[2]))
    elif len(sys.argv) == 1:
        TARGET = (minikube_ip(), envoy_node_port())
    else:
        raise SystemExit(__doc__)
    asyncio.run(main())
