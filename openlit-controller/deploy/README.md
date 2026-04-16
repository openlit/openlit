# OpenLIT Controller — Deployment & Demos

Ready-to-run demos for every deployment mode. Each folder contains everything you need to get the controller running with sample LLM apps.

All images are **built from source** — no pre-built images are pulled from a registry. All demos use the same sample apps from `examples/` (OpenAI, Anthropic, Gemini, CrewAI) so behavior is consistent across platforms.

## Pick your platform

| Platform | Setup time | What you need |
|----------|-----------|---------------|
| [**Docker**](./docker/) | ~2 minutes | Docker + Docker Compose + full repo clone |
| [**Kubernetes**](./kubernetes/) | ~3 minutes | kubectl + a cluster + Docker + full repo clone |
| [**Linux**](./linux/) | ~3 minutes | Linux machine + Docker + Go + Python 3 |

## Docker (recommended for trying it out)

```bash
cd docker
docker compose up -d --build
# Open http://localhost:3000
```

[Full instructions →](./docker/README.md)

## Kubernetes

```bash
cd kubernetes
bash setup.sh
kubectl port-forward -n openlit svc/openlit 3000:3000
# Open http://localhost:3000
```

[Full instructions →](./kubernetes/README.md)

## Linux (bare metal)

```bash
cd linux
sudo bash setup.sh
# Open http://localhost:3000
```

[Full instructions →](./linux/README.md)

## Production deployment

For production use, we recommend the **Helm chart**:

```bash
helm repo add openlit https://openlit.github.io/helm
helm install openlit openlit/openlit --set openlit-controller.enabled=true
```

Or use the **install script** for bare-metal Linux:

```bash
curl -sSL https://get.openlit.io/controller | sudo bash
```
