"""Fork: clean up the calendar points of 3.1.1.1 and before.

Each calendar used to have an invisible point in the plan (furniture of type "x_calendar"). Since 3.1.1.2 the
calendars are chosen in the settings and their events show in the glass card "Today in the household", so the
points' calendars move into settings.x_calendar.entities and the points leave the plan. Mirrors
dropCalendarPoints in frontend/src/calendar.ts.
"""

from __future__ import annotations

from typing import Any

LEGACY_CALENDAR_TYPE = "x_calendar"


def _is_calendar(entity: Any) -> bool:
    return isinstance(entity, str) and entity.startswith("calendar.")


def drop_calendar_points(building: dict[str, Any]) -> bool:
    """Move the calendar points' calendars into the settings and remove the points; whether anything changed."""
    changed = False
    found: list[str] = []
    for floor in building.get("floors") or []:
        items = floor.get("furniture") or []
        keep = []
        for item in items:
            if item.get("type") != LEGACY_CALENDAR_TYPE:
                keep.append(item)
            elif _is_calendar(item.get("x_cal_entity")):
                found.append(item["x_cal_entity"])
        if len(keep) != len(items):
            floor["furniture"] = keep
            changed = True
    settings = building.get("settings")
    if found and isinstance(settings, dict):
        cal = settings.get("x_calendar") or {}
        before = [e for e in dict.fromkeys(cal.get("entities") or []) if _is_calendar(e)]
        entities = list(dict.fromkeys([*before, *found]))
        if len(entities) != len(before):
            settings["x_calendar"] = {**cal, "entities": entities}
    return changed
