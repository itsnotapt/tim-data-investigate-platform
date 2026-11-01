# Deployment example

The example for deploying TIM: the repository behind a deployment, with a provider, the instance files, and how to build and deploy them. [docs/actions.md](../../docs/actions.md) walks through it.

- **`src/example_provider/`**: the provider. It holds the `storm_summary` action type, the `lookup` connection type with its hook, the State regions action, and an action file in the package data.
- **`tests/`**: the provider's tests, with `tim_actions.testing`.
- **`config/`**: the action files, the connections file and the labels file, mounted at `/etc/tim`.
- **`schema/`**: the files' JSON Schemas with the provider's types, written by `./schema.sh <api image>`.
- **`Dockerfile`**: the derived image, TIM's api image with the provider installed.
- **`deploy/`**: the Compose variables and the Helm values.
- **`ci.sh`**: the checks that `.github/workflows/build-api.yml` runs, `./ci.sh <api image>`. They need Docker and uv.

TIM's own CI runs `ci.sh` against each pull request's api image.
