"""Exact symbolic operations kept separate from numeric evaluation."""

import sympy as sp

from .expressions import parse_expression


def simplify(expression: str) -> dict[str, str]:
    result = sp.simplify(parse_expression(expression))
    return {"exact": str(result), "latex": sp.latex(result)}
