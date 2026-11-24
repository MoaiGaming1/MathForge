import json
from io import StringIO

from mathforge_engine.protocol import dispatch, serve


def test_health_has_version_and_capabilities():
    response = dispatch({"id": "health-1", "operation": "health"})
    assert response["ok"] is True
    assert response["id"] == "health-1"
    assert "symbolic.simplify" in response["result"]["capabilities"]


def test_simplify_returns_exact_and_latex():
    response = dispatch({"id": 7, "operation": "symbolic.simplify", "expression": "(x^2 - 1)/(x - 1)"})
    assert response["ok"] is True
    assert response["result"] == {"exact": "x + 1", "latex": "x + 1"}


def test_rejects_python_execution_syntax():
    response = dispatch({"id": "unsafe", "operation": "symbolic.simplify", "expression": "__import__('os')"})
    assert response["ok"] is False
    assert response["error"]["code"] == "invalid_expression"


def test_json_lines_round_trip():
    source = StringIO('{"id":"a","operation":"health"}\n')
    destination = StringIO()
    serve(source, destination)
    assert json.loads(destination.getvalue())["id"] == "a"
