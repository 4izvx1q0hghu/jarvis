import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.config import Settings  # noqa: E402
from jarvis.llm import FakeLLM  # noqa: E402
from jarvis.runtime import Runtime  # noqa: E402


@pytest.fixture
def settings(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    return Settings(
        provider="fake",
        data_dir=tmp_path / "data",
        allowed_dirs=[work.resolve()],
        auth_token="test-token",
    )


@pytest.fixture
def runtime(settings):
    return Runtime(settings, llm=FakeLLM())
