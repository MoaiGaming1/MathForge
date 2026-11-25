import pytest

from mathforge_engine.expressions import ExpressionError, parse_expression
from mathforge_engine.protocol import dispatch
from mathforge_engine.visualization import visualize


def test_graphs_are_explicitly_marked_as_numerical_and_multiple_functions_are_sampled():
    result = visualize("visualize.graph2d", "y=x^2\nsin(x)", {"xRange": [-3, 3], "yRange": [-2, 9], "samples": 121})
    assert result["approximate"] is True
    assert len(result["series"]) == 2
    assert result["series"][0]["points"][60] == [0.0, 0.0]


def test_implicit_2d_equations_produce_grid_values_for_contouring():
    result = visualize("visualize.graph2d", "x^2+y^2=4", {"samples": 121})
    implicit = result["series"][0]
    assert implicit["kind"] == "implicit"
    assert len(implicit["values"]) >= 80
    center = len(implicit["values"]) // 2
    assert implicit["values"][center][center] == pytest.approx(-4, abs=0.1)


def test_sampling_breaks_discontinuities_and_contains_numerical_overflow():
    reciprocal = visualize("visualize.graph2d", "1/x", {"samples": 401})
    y_values = [point[1] for point in reciprocal["series"][0]["points"]]
    assert y_values[199] is None or y_values[200] is None or y_values[201] is None
    overflow = visualize("visualize.graph2d", "exp(1000*x)", {"xRange": [0, 2], "yRange": [-10, 10], "samples": 81})
    assert any(point[1] is None for point in overflow["series"][0]["points"])


def test_complex_values_keep_exact_labels_and_equations_show_all_roots():
    point = visualize("visualize.complexPlane", "1+2*i", {})
    assert point["points"][0]["exact"] == "1 + 2*I"
    assert (point["points"][0]["real"], point["points"][0]["imaginary"]) == (1, 2)
    roots = visualize("visualize.complexPlane", "x^2+1=0", {})
    assert len(roots["points"]) == 2
    assert {root["exact"] for root in roots["points"]} == {"-I", "I"}
    assert all(root["visible"] for root in roots["points"])
    assert roots["solutionSetComplete"] is True
    periodic = visualize("visualize.complexPlane", "sin(x)=0", {})
    assert periodic["solutionSetComplete"] is False
    assert "may be only partially represented" in periodic["warning"]


def test_graph3d_supports_scalar_and_complete_implicit_surface_samples():
    surface = visualize("visualize.graph3d", "z=x^2+y^2", {"resolution": 10})
    assert surface["kind"] == "surface3d"
    assert len(surface["z"]) == 10
    implicit = visualize("visualize.graph3d", "x^2+y^2+z^2=9", {"resolution": 10})
    assert implicit["kind"] == "implicit3d"
    assert len(implicit["values"]) == 10
    assert implicit["values"][5][5][5] < 0


def test_vector_parser_distinguishes_basis_vectors_from_complex_i():
    vector = visualize("visualize.graph3d", "3*i+2*j-k", {})
    assert vector["kind"] == "vector3d"
    assert vector["vectors"] == [[3.0, 2.0, -1.0]]
    assert vector["exactVectors"] == [["3", "2", "-1"]]
    assert str(parse_expression("1+2*i")) == "1 + 2*I"


def test_matrix_backed_vectors_use_notebook_variables_in_3d_view():
    result = visualize("visualize.graph3d", "v", {"resolution": 8}, ["x=2", "v=[x,2x,3]"])
    assert result["kind"] == "vector3d"
    assert result["vectors"] == [[2.0, 4.0, 3.0]]
    assert result["exactVectors"] == [["2", "4", "3"]]


def test_vector_field_and_parametric_curve_have_distinct_outputs():
    field = visualize("visualize.graph3d", "F(x,y,z)=x*i+y*j+z*k", {"resolution": 12})
    curve = visualize("visualize.graph3d", "r(t)=cos(t)*i+sin(t)*j+t*k", {"resolution": 12, "parameterRange": [0, 3.14]})
    assert field["kind"] == "field3d"
    assert 1 < len(field["vectors"]) <= 512
    assert field["vectors"][0][3:] == field["vectors"][0][:3]
    assert curve["kind"] == "curve3d"
    assert len(curve["curve"]) == 96


def test_ambiguous_vector_operations_are_rejected():
    with pytest.raises(ExpressionError, match="Multiplying two vector expressions"):
        visualize("visualize.graph3d", "i*j", {})


def test_visualization_rejects_unsafe_syntax_and_unstable_option_ranges():
    with pytest.raises(ExpressionError):
        visualize("visualize.graph2d", "__import__('os').system('whoami')", {})
    with pytest.raises(ExpressionError):
        visualize("visualize.graph2d", "x", {"xRange": [4, 4]})
    with pytest.raises(ExpressionError):
        visualize("visualize.graph3d", "x+y", {"resolution": 100})


def test_ordinary_symbolic_calculation_supports_complex_unit_exactly():
    assert str(parse_expression("1+2*i")) == "1 + 2*I"


def test_visualization_protocol_dispatches_supported_operations():
    response = dispatch({"id": "graph", "operation": "visualize.graph2d", "expression": "x^2", "options": {"samples": 50}})
    assert response["ok"] is True
    assert response["result"]["kind"] == "graph2d"
    assert response["result"]["approximate"] is True


def test_complex_points_near_infinity_are_rejected_instead_of_drawn():
    with pytest.raises(ExpressionError):
        visualize("visualize.complexPlane", "1/0", {})
