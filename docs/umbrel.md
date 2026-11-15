# Umbrel packaging roadmap

The two-container architecture, non-root processes, health endpoint and persistent `/data` volume are designed to be portable to an Umbrel package. This repository is not yet an Umbrel app-store package.

Before packaging:

1. Publish reproducible amd64/arm64 images, pin digests and scan images.
2. Add Umbrel's current manifest, icon and screenshots under the required package convention.
3. Adapt the HTTP port, app-proxy integration and persistent data path.
4. Set the exact Umbrel hostname/origin allowlists; enable secure cookies if TLS terminates at the proxy.
5. Provision a dedicated read-only Bitcoin RPC user without sharing broader node credentials.
6. Test first-run setup, upgrades, ownership of `/data`, encrypted restore and wallet reconciliation on a real Umbrel installation.

Keep the local owner authentication even behind the Umbrel app proxy. Do not expose either the FastAPI container or Bitcoin Core RPC directly to the public network.
