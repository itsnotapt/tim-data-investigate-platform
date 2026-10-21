"""TIM's built-in provider, registered through the ``tim.actions`` entry point like any other."""

from tim_actions.provider import Provider


def provider() -> Provider:
    return Provider()
