"""``GET /api/me``: the caller as the API knows them."""

from __future__ import annotations

from tim_api.models_common import ApiModel


class Me(ApiModel):
    """The caller as the API knows them: ``name`` is what their comments, presets and runs carry."""

    name: str
