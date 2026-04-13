# OpenLIT Controller — Deployment & Demos

Ready-to-run demos for every deployment mode. Each folder contains everything you need to get the controller running with sample LLM apps.

All demos use the same sample apps from `examples/` (OpenAI, Anthropic, Gemini) so behavior is consistent across platforms.

## Pick your platform

| Platform | Setup time | What you need |
|----------|-----------|---------------|
| [**Docker**](./docker/) | ~1 minute | Docker + Docker Compose |
| [**Kubernetes**](./kubernetes/) | ~2 minutes | kubectl + a cluster |
| [**Linux**](./linux/) | ~2 minutes | Linux machine + Docker + Python 3 |

## Docker (recommended for trying it out)

```bash
cd docker
docker compose up -d
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
