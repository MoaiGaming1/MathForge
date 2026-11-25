import pytest

from mathforge_engine.expressions import ExpressionError, parse_expression
from mathforge_engine.symbolic import simplify


def test_row_column_and_rectangular_matrices_share_sympy_matrix_representation():
    row = parse_expression("[1,2,3]")
    column = parse_expression("[1;2;3]")
    rectangular = parse_expression("[1,2,3;4,5,6]")
    assert (row.rows, row.cols) == (1, 3)
    assert (column.rows, column.cols) == (3, 1)
    assert (rectangular.rows, rectangular.cols) == (2, 3)
    assert simplify("[1,2,3;4,5,6]")["exact"] == "[1, 2, 3; 4, 5, 6]"
    assert "\\begin{matrix}" in simplify("[1,2,3;4,5,6]")["latex"]


def test_exact_matrix_arithmetic_products_and_powers():
    assert simplify("[1,2;3,4]+[5,6;7,8]")["exact"] == "[6, 8; 10, 12]"
    assert simplify("[1,2;3,4]-[1,1;1,1]")["exact"] == "[0, 1; 2, 3]"
    assert simplify("3*[1,2]")["exact"] == "[3, 6]"
    assert simplify("[1,2;3,4]*[5;6]")["exact"] == "[17; 39]"
    assert simplify("[1,2]*[3,4;5,6]")["exact"] == "[13, 16]"
    assert simplify("[1,2;3,4]^2")["exact"] == "[7, 10; 15, 22]"
    assert simplify("[1,2;3,4]/2")["exact"] == "[1/2, 1; 3/2, 2]"


def test_transpose_determinant_inverse_trace_and_components():
    assert simplify("transpose([1,2])")["exact"] == "[1; 2]"
    assert simplify("transpose([1;2])")["exact"] == "[1, 2]"
    assert simplify("[1,2;3,4]^T")["exact"] == "[1, 3; 2, 4]"
    assert simplify("det([1,2;3,4])")["exact"] == "-2"
    assert simplify("inverse([1,2;3,4])")["exact"] == "[-2, 1; 3/2, -1/2]"
    assert simplify("trace([1,2;3,4])")["exact"] == "5"
    assert simplify("entry([1,2;3,4],2,1)")["exact"] == "3"
    assert simplify("A[2,1]", ["A=[1,2;3,4]"])["exact"] == "3"


def test_vector_operations_are_matrix_operations_with_dimension_validation():
    assert simplify("dot([1,2,3],[4,5,6])")["exact"] == "32"
    assert simplify("cross([1,0,0],[0,1,0])")["exact"] == "[0, 0, 1]"
    assert simplify("norm([3;4])")["exact"] == "5"
    assert simplify("normalize([3,4])")["exact"] == "[3/5, 4/5]"
    with pytest.raises(ExpressionError, match="square matrix"):
        simplify("det([1,2,3;4,5,6])")
    with pytest.raises(ExpressionError, match="singular"):
        simplify("inverse([1,2;2,4])")
    with pytest.raises(ExpressionError, match="equal length"):
        simplify("dot([1,2],[1,2,3])")
    with pytest.raises(ExpressionError, match="three-dimensional"):
        simplify("cross([1,2],[3,4])")
    with pytest.raises(ExpressionError, match="zero vector"):
        simplify("normalize([0,0,0])")
    with pytest.raises(ExpressionError, match="same positive number"):
        simplify("[1,2;3]")
    with pytest.raises(ExpressionError, match="dimensions"):
        simplify("[1,2;3,4]+[1,2,3]")


def test_symbolic_matrix_entries_and_implicit_multiplication_remain_exact():
    assert simplify("3x+2(x+1)")["exact"] == "5*x + 2"
    assert simplify("det([x,1;1,x])")["exact"] == "x**2 - 1"
    assert simplify("A=[x,1;1,x]")["exact"] == "A = [x, 1; 1, x]"
    assert simplify("det(A)", ["A=[x,1;1,x]"])["exact"] == "x**2 - 1"
