# tim-actions

The interface TIM providers build against: the base classes of action types, connection types and hooks, `Provider`, and `tim_actions.testing`. It is released on its own semver (`tim-actions-vX.Y.Z`). Providers declare `tim-actions>=1,<2`.

- Writing action types, connection types and hooks, providers and tests: [docs/actions.md](../../docs/actions.md#writing-action-types) (sections Writing action types to Testing).
- A working provider with its tests, files and deployment: [examples/instance/](../../examples/instance/README.md).
- How TIM loads providers: [architecture.md](../../docs/architecture.md#actions-and-providers).
