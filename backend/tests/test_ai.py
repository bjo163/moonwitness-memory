from app.ai import _confidence, _string_list


def test_string_list_accepts_scalar_without_splitting_characters():
    assert _string_list("project tag", 10, 80) == ["project tag"]


def test_string_list_deduplicates_and_limits_items():
    assert _string_list(["one", "one", 2, None, "three"], 2, 80) == ["one", "2"]


def test_confidence_is_clamped_and_invalid_values_default():
    assert _confidence(1.5) == 1.0
    assert _confidence(-0.2) == 0.0
    assert _confidence("not-a-number") == 0.5
