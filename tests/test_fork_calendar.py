"""Fork: the calendar points of 3.1.1.1 and before become calendars of the household card, once, on load."""

from __future__ import annotations

import copy

from homeassistant.core import HomeAssistant

from custom_components.neonplan3d.const import STORAGE_KEY_BUILDING
from custom_components.neonplan3d.fork_calendar import drop_calendar_points

from .test_init import BUILDING, _setup


def _point(item_id: str, entity: str | None) -> dict:
    return {
        "id": item_id,
        "type": "x_calendar",
        "x": 1,
        "z": 1,
        "rotation": 0,
        "w": 0.4,
        "d": 0.4,
        "h": 1.6,
        "variant": None,
        "x_cal_entity": entity,
    }


def test_points_move_into_the_settings() -> None:
    building = {
        "settings": {"x_calendar": {"count": 3, "entities": ["calendar.arbeit"]}},
        "floors": [
            {
                "id": "eg",
                "furniture": [_point("a", "calendar.familie"), _point("b", None), {"id": "d", "type": "sofa"}],
            },
            {"id": "og", "furniture": [_point("c", "calendar.arbeit"), _point("e", "sensor.x")]},
        ],
    }
    assert drop_calendar_points(building) is True
    assert [[m["id"] for m in f["furniture"]] for f in building["floors"]] == [["d"], []]
    assert building["settings"]["x_calendar"] == {"count": 3, "entities": ["calendar.arbeit", "calendar.familie"]}
    # a clean plan stays as it is
    assert drop_calendar_points(building) is False


async def test_stored_points_are_cleaned_up_on_load(hass: HomeAssistant, hass_ws_client, hass_storage) -> None:
    building = copy.deepcopy(BUILDING)
    building["floors"][0]["furniture"] = [_point("cal1", "calendar.familie")]
    hass_storage[STORAGE_KEY_BUILDING] = {
        "version": 1,
        "minor_version": 2,
        "key": STORAGE_KEY_BUILDING,
        "data": {"revision": 4, "building": building},
    }
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "neonplan3d/building/get"})
    got = (await client.receive_json())["result"]
    assert got["revision"] == 4
    assert got["building"]["floors"][0]["furniture"] == []
    assert got["building"]["settings"]["x_calendar"]["entities"] == ["calendar.familie"]
    stored = hass_storage[STORAGE_KEY_BUILDING]["data"]["building"]
    assert stored["floors"][0]["furniture"] == []
