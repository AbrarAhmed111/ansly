"""
Structured Resume JSON schema (v1.2): fixtures validate, round-trip, and stay strict.
"""

import copy
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.app.core.rate_limit import check_daily_tailoring_limit
from src.app.schemas.resume import STRUCTURED_RESUME_SCHEMA_VERSION, StructuredResume
from tests.fakes import FakeRest

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "types" / "fixtures" / "structured-resume"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(p.name for p in FIXTURES.glob("*.json")))
def test_fixtures_validate_and_round_trip(name):
    raw = load(name)
    resume = StructuredResume.model_validate(raw)
    assert resume.schema_version == STRUCTURED_RESUME_SCHEMA_VERSION
    assert resume.to_json() == raw


def test_fixtures_exist():
    assert len(list(FIXTURES.glob("*.json"))) >= 2


def test_ids_cover_items_and_bullets():
    resume = StructuredResume.model_validate(load("full-stack-engineer.json"))
    ids = set(resume.iter_ids())
    assert {"exp_1", "exp_1_b2", "proj_1_b1", "skills_3", "edu_1", "ach_1", "custom_1_b1"} <= ids


def test_duplicate_ids_are_rejected():
    raw = load("full-stack-engineer.json")
    raw["projects"][0]["bullets"][0]["id"] = "exp_1_b1"
    with pytest.raises(ValidationError, match="duplicate id"):
        StructuredResume.model_validate(raw)


def test_unknown_schema_version_and_fields_are_rejected():
    raw = load("minimal.json")
    with pytest.raises(ValidationError):
        StructuredResume.model_validate({**raw, "schemaVersion": 2})
    with pytest.raises(ValidationError):
        StructuredResume.model_validate({**raw, "photo": "base64..."})


def test_snake_case_input_is_accepted():
    raw = copy.deepcopy(load("minimal.json"))
    raw["experience"][0]["is_current"] = raw["experience"][0].pop("isCurrent")
    assert StructuredResume.model_validate(raw).experience[0].is_current is False


@pytest.mark.anyio
async def test_daily_tailoring_limit_counts_only_tailorings():
    rest = FakeRest()
    rest.tables["usage_events"] = [{"kind": "generate"}] * 50 + [{"kind": "tailoring_started"}] * 2
    await check_daily_tailoring_limit(rest, 3)
    rest.tables["usage_events"].append({"kind": "tailoring_started"})
    with pytest.raises(HTTPException) as exc:
        await check_daily_tailoring_limit(rest, 3)
    assert exc.value.status_code == 429
    assert "tailored resumes" in exc.value.detail
