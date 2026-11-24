"""Safe expression parsing helpers for the supported symbolic operations."""

import ast
import operator

import sympy as sp

_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCTIONS = {"sqrt": sp.sqrt, "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "exp": sp.exp, "log": sp.log}
_CONSTANTS = {"pi": sp.pi, "E": sp.E}


class ExpressionError(ValueError):
    """Raised when an expression uses syntax outside the math input grammar."""


def parse_expression(source: str) -> sp.Expr:
    if not source.strip():
        raise ExpressionError("Expression cannot be empty.")
    if len(source) > 2_000:
        raise ExpressionError("Expression is too long (maximum 2000 characters).")
    try:
        tree = ast.parse(source.replace("^", "**"), mode="eval")
        return _convert(tree.body)
    except (SyntaxError, RecursionError) as error:
        raise ExpressionError("Expression syntax is not valid.") from error
    except (TypeError, ValueError, OverflowError) as error:
        raise ExpressionError(str(error)) from error


def _convert(node: ast.AST) -> sp.Expr:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        if isinstance(node.value, float) and not (float("-inf") < node.value < float("inf")):
            raise ExpressionError("Number must be finite.")
        return sp.Integer(node.value) if isinstance(node.value, int) else sp.Float(node.value)
    if isinstance(node, ast.Name):
        if node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        if node.id.isidentifier() and not node.id.startswith("__"):
            return sp.Symbol(node.id)
        raise ExpressionError(f"Unsupported name: {node.id}")
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        return _BINARY[type(node.op)](_convert(node.left), _convert(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_convert(node.operand))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCTIONS and not node.keywords and len(node.args) == 1:
        return _FUNCTIONS[node.func.id](_convert(node.args[0]))
    raise ExpressionError("Use numbers, variables, +, -, *, /, ^, parentheses, and supported functions.")
