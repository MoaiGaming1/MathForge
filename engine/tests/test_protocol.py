import json
import math
from io import StringIO

import pytest
import sympy as sp
from mathforge_engine.protocol import dispatch, serve
from mathforge_engine.expressions import parse_notebook_expression


def test_health_has_version_and_capabilities():
    response = dispatch({"id": "health-1", "operation": "health"})
    assert response["ok"] is True
    assert response["id"] == "health-1"
    assert "symbolic.simplify" in response["result"]["capabilities"]


def test_simplify_returns_exact_and_latex():
    response = dispatch({"id": 7, "operation": "symbolic.simplify", "expression": "(x^2 - 1)/(x - 1)"})
    assert response["ok"] is True
    assert response["result"] == {"exact": "x + 1", "latex": "x + 1", "approximate": False, "warning": None}


def test_rejects_python_execution_syntax():
    response = dispatch({"id": "unsafe", "operation": "symbolic.simplify", "expression": "__import__('os')"})
    assert response["ok"] is False
    assert response["error"]["code"] == "invalid_expression"


def test_json_lines_round_trip():
    source = StringIO('{"id":"a","operation":"health"}\n')
    destination = StringIO()
    serve(source, destination)
    assert json.loads(destination.getvalue())["id"] == "a"


def test_nested_and_nth_roots_use_the_restricted_symbolic_parser():
    response = dispatch({
        "id": "roots",
        "operation": "symbolic.simplify",
        "expression": "sqrt(nthroot(64, 3))",
    })
    assert response["ok"] is True
    assert response["result"]["exact"] == "2"


def test_mathlive_determinant_delimiters_reach_sympy_matrix_evaluation():
    # Frontend normalization of `\\det\\left(\\left\\lbrack5,5;5,5\\right\\rbrack\\right)`.
    response = dispatch({"id": "det-mathlive", "operation": "symbolic.simplify", "expression": "det([5,5;5,5])"})
    assert response["ok"] is True
    assert response["result"]["exact"] == "0"
    assert response["result"]["latex"] == "0"


def test_inverse_trigonometric_functions_are_restricted_and_exact():
    asin = dispatch({"id": "asin", "operation": "symbolic.simplify", "expression": "asin(1)"})
    acos = dispatch({"id": "acos", "operation": "symbolic.simplify", "expression": "arccos(0)"})
    atan = dispatch({"id": "atan", "operation": "symbolic.simplify", "expression": "atan(1)"})
    assert [asin["result"]["exact"], acos["result"]["exact"], atan["result"]["exact"]] == ["pi/2", "pi/2", "pi/4"]


def test_piecewise_expression_evaluates_and_graphs_discontinuities_with_safe_conditions():
    source = "piecewise(-x,x<0,x,x>=0,0)"
    assert parse_notebook_expression(source).subs(sp.Symbol("x"), -2) == 2
    graph = dispatch({"id": "piecewise", "operation": "visualize.graph2d", "expression": source,
                      "options": {"xRange": [-2, 2], "yRange": [-2, 2], "samples": 41}})
    assert graph["ok"] is True
    points = graph["result"]["series"][0]["points"]
    assert points[10][1] == pytest.approx(1)
    assert points[30][1] == pytest.approx(1)


def test_infinity_constant_and_function_arity_are_validated():
    infinity = dispatch({"id": "infinity", "operation": "symbolic.simplify", "expression": "infinity"})
    assert infinity["ok"] is True
    assert infinity["result"]["exact"] == "oo"

    invalid = dispatch({"id": "arity", "operation": "symbolic.simplify", "expression": "nthroot(x)"})
    assert invalid["ok"] is False
    assert "expects 2 argument" in invalid["error"]["message"]


def test_decimal_results_are_marked_as_approximate():
    response = dispatch({"id": "decimal", "operation": "symbolic.simplify", "expression": "0.1+0.2"})
    assert response["ok"] is True
    assert response["result"]["approximate"] is True
    assert "numerical approximation" in response["result"]["warning"]


def test_rational_results_remain_exact():
    response = dispatch({"id": "rational", "operation": "symbolic.simplify", "expression": "1/3"})
    assert response["result"]["approximate"] is False
    assert response["result"]["exact"] == "1/3"


def test_assignment_and_variable_dependent_complex_reproduction():
    first = dispatch({"id": "assignment", "operation": "symbolic.simplify", "expression": "x=5", "context": []})
    assert first["ok"] is True
    assert first["result"]["exact"] == "x = 5"

    # This is the normalized MathLive source for the screenshot expression.
    expression = "5* cos(x* ((pi)/(180)))+i* 5* sin(x* ((pi)/(180)))"
    second = dispatch({"id": "dependent", "operation": "symbolic.simplify", "expression": expression, "context": ["x=5"]})
    assert second["ok"] is True
    numeric = complex(parse_notebook_expression(expression, ["x=5"]).evalf(12))
    assert math.isclose(numeric.real, 4.9809734905, abs_tol=1e-9)
    assert math.isclose(numeric.imag, 0.4357787137, abs_tol=1e-9)

    plotted = dispatch({"id": "complex", "operation": "visualize.complexPlane", "expression": expression,
                        "options": {"precision": 30}, "context": ["x=5"]})
    assert plotted["ok"] is True
    point = plotted["result"]["points"][0]
    assert math.isclose(point["real"], 4.9809734905, abs_tol=1e-9)
    assert math.isclose(point["imaginary"], 0.4357787137, abs_tol=1e-9)


def test_notebook_variables_functions_and_redefinitions_are_contextual():
    context = ["a=5", "b=3"]
    assert dispatch({"id": "sum", "operation": "symbolic.simplify", "expression": "a+b", "context": context})["result"]["exact"] == "8"
    fn = dispatch({"id": "function", "operation": "symbolic.simplify", "expression": "f(x)=sin(x)", "context": context})
    assert fn["ok"] is True
    assert dispatch({"id": "call", "operation": "symbolic.simplify", "expression": "f(pi/2)", "context": context + ["f(x)=sin(x)"]})["result"]["exact"] == "1"

    expression = "a+1"
    old = dispatch({"id": "old", "operation": "symbolic.simplify", "expression": expression, "context": ["a=5"]})
    changed = dispatch({"id": "changed", "operation": "symbolic.simplify", "expression": expression, "context": ["a=9"]})
    deleted = dispatch({"id": "deleted", "operation": "symbolic.simplify", "expression": expression, "context": []})
    assert [old["result"]["exact"], changed["result"]["exact"], deleted["result"]["exact"]] == ["6", "10", "a + 1"]


def test_invalid_prior_definition_does_not_silently_evaluate_as_free_variable():
    response = dispatch({"id": "bad-context", "operation": "symbolic.simplify", "expression": "x+1", "context": ["x="]})
    assert response["ok"] is False
    assert "previous notebook definition" in response["error"]["message"]


def test_multi_argument_functions_nesting_updates_deletion_and_errors():
    context = ["a=3", "f(x)=a*x^2", "g(x,y)=f(x)+y", "h(x,y)=g(x,y)+f(y)"]
    assert dispatch({"id": "f", "operation": "symbolic.simplify", "expression": "f(4)", "context": context})["result"]["exact"] == "48"
    assert dispatch({"id": "g", "operation": "symbolic.simplify", "expression": "g(4,2)", "context": context})["result"]["exact"] == "50"
    assert dispatch({"id": "h", "operation": "symbolic.simplify", "expression": "h(2,3)", "context": context})["result"]["exact"] == "42"
    changed = dispatch({"id": "changed", "operation": "symbolic.simplify", "expression": "f(4)", "context": ["a=5", *context[1:]]})
    assert changed["result"]["exact"] == "80"
    deleted = dispatch({"id": "deleted", "operation": "symbolic.simplify", "expression": "f(4)", "context": []})
    assert deleted["ok"] is False and "Undefined function" in deleted["error"]["message"]
    wrong_arity = dispatch({"id": "arity", "operation": "symbolic.simplify", "expression": "g(4)", "context": context})
    assert wrong_arity["ok"] is False and "expects 2 argument" in wrong_arity["error"]["message"]
    circular = dispatch({"id": "cycle", "operation": "symbolic.simplify", "expression": "q(x)=q(x)+1", "context": []})
    assert circular["ok"] is False and "Circular" in circular["error"]["message"]
    undefined = dispatch({"id": "unknown", "operation": "symbolic.simplify", "expression": "missing(1)", "context": []})
    assert undefined["ok"] is False and "Undefined function" in undefined["error"]["message"]


def test_function_identifiers_are_general_and_argument_grammar_is_bounded():
    context = ["velocity(t)=3*t+5", "response(alpha,beta)=alpha^2-beta^2", "combine(a,b,c)=a+2*b+3*c"]
    assert dispatch({"id": "velocity", "operation": "symbolic.simplify", "expression": "velocity(4)", "context": context})["result"]["exact"] == "17"
    assert dispatch({"id": "response", "operation": "symbolic.simplify", "expression": "response(5,2)", "context": context})["result"]["exact"] == "21"
    assert dispatch({"id": "combine", "operation": "symbolic.simplify", "expression": "combine(1,2,3)", "context": context})["result"]["exact"] == "14"
    assert dispatch({"id": "symbolic", "operation": "symbolic.simplify", "expression": "response(u,v)", "context": context})["result"]["exact"] == "u**2 - v**2"
    too_many = "many(" + ",".join(f"x{i}" for i in range(17)) + ")=1"
    result = dispatch({"id": "arg-limit", "operation": "symbolic.simplify", "expression": too_many})
    assert result["ok"] is False and "between 1 and 16" in result["error"]["message"]


def test_user_defined_functions_work_with_existing_visualization_pipeline():
    graph = dispatch({"id": "plot", "operation": "visualize.graph2d", "expression": "f(x)",
                      "options": {"xRange": [-3, 3], "samples": 41}, "context": ["f(x)=sin(x)"]})
    assert graph["ok"] is True
    assert graph["result"]["series"][0]["kind"] == "function"
    assert len(graph["result"]["series"][0]["points"]) == 41

    surface = dispatch({"id": "surface", "operation": "visualize.graph3d", "expression": "f(x,y)",
                        "options": {"resolution": 8}, "context": ["f(x,y)=x^2+y^2"]})
    assert surface["ok"] is True
    assert surface["result"]["kind"] == "surface3d"


def test_direct_2d_function_definitions_graph_with_dependencies_and_multiple_functions():
    graph = dispatch({
        "id": "direct-function-graph", "operation": "visualize.graph2d",
        "expression": "f(x)=a*x\ng(x)=x^2", "options": {"xRange": [-2, 2], "yRange": [-5, 5], "samples": 41},
        "context": ["a=3"],
    })
    assert graph["ok"] is True
    assert [series["kind"] for series in graph["result"]["series"]] == ["function", "function"]
    assert graph["result"]["series"][0]["points"][30][1] == pytest.approx(3)
    assert graph["result"]["series"][1]["points"][30][1] == pytest.approx(1)
    changed = dispatch({
        "id": "updated-function-graph", "operation": "visualize.graph2d",
        "expression": "f(x)=a*x", "options": {"xRange": [-2, 2], "yRange": [-5, 5], "samples": 41},
        "context": ["a=4"],
    })
    assert changed["ok"] is True
    assert changed["result"]["series"][0]["points"][30][1] == pytest.approx(4)


def test_arbitrary_function_names_and_two_argument_contours_work_in_2d():
    graph = dispatch({
        "id": "named-2d-functions", "operation": "visualize.graph2d",
        "expression": "velocity(t)=3*t+5\nlevel(u,v)=u^2+v^2-1",
        "options": {"xRange": [-2, 2], "yRange": [-10, 10], "samples": 41}, "context": [],
    })
    assert graph["ok"] is True
    assert graph["result"]["series"][0]["points"][30][1] == pytest.approx(8)
    assert graph["result"]["series"][1]["kind"] == "implicit"
    assert graph["result"]["series"][1]["values"][40][40] == pytest.approx(-1, abs=0.2)


def test_named_two_argument_function_definition_is_a_3d_surface():
    graph = dispatch({
        "id": "function-surface", "operation": "visualize.graph3d", "expression": "height(u,v)=u^2+v^2",
        "options": {"xRange": [-1, 1], "yRange": [-1, 1], "zRange": [0, 2], "resolution": 9}, "context": [],
    })
    assert graph["ok"] is True
    assert graph["result"]["kind"] == "surface3d"
    assert graph["result"]["z"][4][4] == pytest.approx(0)
