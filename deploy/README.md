# Deployment files

- `compose.prod.yaml`, `.env.example`: production Docker Compose stack.
- `config/`: instance files the stack mounts at `/etc/tim`. See [config/README.md](config/README.md).
- `helm/tim/`: Helm chart for Kubernetes, also published to `oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim`.

Both use the same container environment variables. See [docs/deployment.md](../docs/deployment.md).
