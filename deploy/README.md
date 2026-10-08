# Deployment files

- `compose.prod.yaml`, `.env.example`: production Docker Compose stack.
- `helm/tim/`: Helm chart for Kubernetes, also published to `oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim`.

Both use the same container environment variables. See [docs/deployment.md](../docs/deployment.md).
