#!/usr/bin/env python3
"""Configure one browser-based ledger for this computer or a private server."""

import argparse
import ipaddress
import os
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def private_address(value):
    address = ipaddress.IPv4Address(value)
    networks = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10")
    if not any(address in ipaddress.ip_network(network) for network in networks):
        raise ValueError("Use this server's private LAN or VPN IPv4 address.")
    return str(address)


def configuration(mode, bind=None, host=None, port=None):
    port = port if port is not None else (8080 if mode == "computer" else 8443)
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535.")
    values = {"DEMO_ENABLED": "false"}
    if mode == "computer":
        if bind or host:
            raise ValueError("Use node mode for access from other devices.")
        url = f"http://localhost:{port}"
        values.update(
            BIND_ADDRESS="127.0.0.1",
            PORT=str(port),
            COOKIE_SECURE="false",
            APP_ORIGIN=f"{url},http://127.0.0.1:{port}",
            ALLOWED_HOSTS="localhost,127.0.0.1",
        )
    else:
        bind = private_address(bind or "")
        host = host or bind
        if host != bind:
            # Restrict generated dotenv/Caddy values to private DNS names.
            if len(host) > 253 or not re.fullmatch(
                r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|internal|home\.arpa)", host
            ):
                raise ValueError("Host must be the bind IP or a private .local, .internal, or .home.arpa name.")
        url = f"https://{host}" + (f":{port}" if port != 443 else "")
        values.update(
            BIND_ADDRESS=bind,
            LEDGER_HOST=host,
            HTTPS_PORT=str(port),
            COOKIE_SECURE="true",
            APP_ORIGIN=url,
            ALLOWED_HOSTS=f"localhost,127.0.0.1,{host}",
        )
    return values, url


def compose_command(mode, config):
    command = ["docker", "compose", "--env-file", str(config), "-f", "docker-compose.yml"]
    if mode == "node":
        command += ["-f", "deployment/private.compose.yml"]
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("computer", "node"))
    parser.add_argument("--bind", help="Server's private IPv4 address (required for node mode)")
    parser.add_argument("--host", help="Optional private DNS name resolving to --bind")
    parser.add_argument("--port", type=int)
    parser.add_argument("--config", type=Path, default=ROOT / ".env.hosting")
    parser.add_argument("--start", action="store_true", help="Build and start after writing configuration")
    args = parser.parse_args()
    try:
        values, url = configuration(args.mode, args.bind, args.host, args.port)
    except ValueError as error:
        parser.error(str(error))
    config = args.config.resolve()
    try:
        descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error(f"{config} already exists. Reuse it with the documented Docker command, or choose --config.")
    with os.fdopen(descriptor, "w") as output:
        output.write("# Generated browser hosting configuration. Keep private if adding RPC credentials.\n")
        output.writelines(f"{key}={value}\n" for key, value in values.items())
    command = compose_command(args.mode, config)
    print(f"Configuration saved to {config}\nOpen {url} after startup.")
    if args.mode == "node":
        print("Trust the server's root certificate on each device before signing in. See docs/browser-hosting.md.")
    full_command = command + ["up", "--build", "-d", "--wait"]
    print(subprocess.list2cmdline(full_command) if os.name == "nt" else shlex.join(full_command))
    if args.start:
        try:
            subprocess.run(full_command, cwd=ROOT, check=True)
        except (OSError, subprocess.CalledProcessError) as error:
            parser.exit(1, f"Startup failed: {error}. Your configuration was saved; retry the command above.\n")


if __name__ == "__main__":
    main()
