"""Exact symbolic operations kept separate from numeric evaluation."""

import sympy as sp

from .expressions import ExpressionError, notebook_environment, parse_definition, parse_expression, top_level_equals


def _exact(value) -> str:
    if isinstance(value, sp.MatrixBase):
        rows = [", ".join(sp.sstr(value[row, column]) for column in range(value.cols)) for row in range(value.rows)]
        return "[" + "; ".join(rows) + "]"
    return sp.sstr(value)


def simplify(expression: str, context: list[str] | None = None) -> dict[str, str | bool | None]:
    variables, functions = notebook_environment(context)
    if top_level_equals(expression) >= 0:
        definition = parse_definition(expression, variables, functions)
        if definition is None:
            raise ExpressionError("Expression syntax is not valid.")
        name, value = definition
        if isinstance(value, tuple):
            parameters, body = value
            args = ", ".join(sp.sstr(parameter) for parameter in parameters)
            exact = f"{name}({args}) = {_exact(body)}"
            latex = f"{name}({args}) = {sp.latex(body)}"
            result = body
        else:
            exact = f"{name} = {_exact(value)}"
            latex = f"{name} = {sp.latex(value)}"
            result = value
    else:
        result = sp.simplify(parse_expression(expression, variables, functions))
        exact, latex = _exact(result), sp.latex(result)
    approximate = bool(result.has(sp.Float))
    return {
        "exact": exact,
        "latex": latex,
        "approximate": approximate,
        "warning": "This result uses decimal input and is a numerical approximation." if approximate else None,
    }
