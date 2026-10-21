# tim-actions

The interface TIM providers build against, released on its own semver (`tim-actions-vX.Y.Z`). Providers declare `tim-actions>=1,<2`.

- `Action`: the base of a query action type. Subclass it, add your configuration fields and implement `run(params, ctx)`; each instance is one action, with its `key`, `name`, `menu`, `description`, `params`, `pivot`, `columns` and `id`.
- `Param` and `Column`: params and result columns, declared as data. An invalid declaration fails when it is constructed.
- `validate_params(params, values, connections=...)`: validates and converts param values, raising `ParamsError` with errors keyed `params.<name>`.
- `Hook`: access to a connection type's backend, with `cancel()` and `editor_schema(scope)`.
- `Provider(actions, action_types, hooks)`: what a package adds. Expose a callable returning one in the `tim.actions` entry-point group:

  ```toml
  [project.entry-points."tim.actions"]
  acme = "acme_tim:provider"
  ```

TIM's own built-in provider registers the same way (`tim_actions.builtin:provider`). How TIM loads providers: [architecture.md](../../docs/architecture.md#actions-and-providers).
