"""Restricted mathematical parser and notebook-scoped definitions."""

import ast
import io
import operator
import re
import tokenize

import sympy as sp
from sympy.matrices.exceptions import ShapeError

_BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCTIONS = {
    "sqrt": (sp.sqrt, 1), "sin": (sp.sin, 1), "cos": (sp.cos, 1), "tan": (sp.tan, 1),
    "asin": (sp.asin, 1), "acos": (sp.acos, 1), "atan": (sp.atan, 1),
    "arcsin": (sp.asin, 1), "arccos": (sp.acos, 1), "arctan": (sp.atan, 1),
    "exp": (sp.exp, 1), "log": (sp.log, 1), "nthroot": (sp.root, 2), "piecewise": (None, None),
}
_CONSTANTS = {"pi": sp.pi, "E": sp.E, "i": sp.I, "I": sp.I, "infinity": sp.oo, "Infinity": sp.oo, "inf": sp.oo}
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_FUNCTION_DEFINITION = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\((.*?)\)\s*=\s*(.+?)\s*$", re.DOTALL)
_FUNCTIONS_CONTEXT_LIMIT = 5_000
_FUNCTION_ARGUMENT_LIMIT = 16


class ExpressionError(ValueError):
    """Raised when input is outside the restricted mathematical grammar."""


def top_level_equals(source: str) -> int:
    """Find assignment/equation equality while ignoring nested and comparison operators."""
    parentheses = brackets = braces = 0
    for index, char in enumerate(source):
        if char == "(": parentheses += 1
        elif char == ")": parentheses = max(0, parentheses - 1)
        elif char == "[": brackets += 1
        elif char == "]": brackets = max(0, brackets - 1)
        elif char == "{": braces += 1
        elif char == "}": braces = max(0, braces - 1)
        elif char == "=" and not (parentheses or brackets or braces):
            previous = source[index - 1] if index else ""
            following = source[index + 1] if index + 1 < len(source) else ""
            if previous not in "<>!=" and following != "=":
                return index
    return -1


def _matrix_rows(source: str) -> str:
    """Turn row separators inside square-bracket matrix syntax into nested AST lists."""
    stack: list[dict[str, object]] = []
    bracket_depth = paren_depth = 0
    in_string: str | None = None
    escaped = False
    opens_with_rows: set[int] = set()
    closes_with_rows: set[int] = set()
    row_separators: set[int] = set()
    for index, char in enumerate(source):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == in_string:
                in_string = None
            continue
        if char in "'\"":
            in_string = char
        elif char == "[":
            bracket_depth += 1
            stack.append({"open": index, "base_paren": paren_depth, "semicolons": []})
        elif char == "]":
            if stack:
                pair = stack.pop()
                if pair["semicolons"]:
                    opens_with_rows.add(pair["open"])
                    closes_with_rows.add(index)
            bracket_depth -= 1
        elif char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
        elif char == ";" and bracket_depth == 1 and stack and paren_depth == stack[-1]["base_paren"]:
            stack[-1]["semicolons"].append(index)
            row_separators.add(index)
    result: list[str] = []
    for index, char in enumerate(source):
        if index in opens_with_rows: result.append("[[")
        elif index in closes_with_rows: result.append("]]" )
        elif index in row_separators: result.append("],[")
        else: result.append(char)
    return "".join(result)


def _implicit_products(source: str, function_names: set[str]) -> str:
    """Insert multiplication between adjacent mathematical atoms using token boundaries."""
    try:
        tokens = [token for token in tokenize.generate_tokens(io.StringIO(source).readline)
                  if token.type not in {tokenize.ENCODING, tokenize.ENDMARKER, tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT}]
    except (tokenize.TokenError, IndentationError):
        return source
    line_starts = [0]
    for match in re.finditer("\n", source):
        line_starts.append(match.end())
    inserts: list[int] = []
    starts = {tokenize.NAME, tokenize.NUMBER}
    for previous, current in zip(tokens, tokens[1:]):
        left_atom = previous.type in {tokenize.NAME, tokenize.NUMBER} or (previous.type == tokenize.OP and previous.string in {")", "]"})
        right_atom = current.type in starts or (current.type == tokenize.OP and current.string in {"(", "["})
        if not left_atom or not right_atom:
            continue
        if previous.end != current.start:
            # Whitespace between atoms is multiplication in the notebook language too.
            pass
        if previous.type == tokenize.NAME and current.type == tokenize.OP and current.string in {"(", "["}:
            if previous.string in function_names or current.string == "[":
                continue
            # Preserve calls so the evaluator can give a clear undefined-function error.
            continue
        if previous.type == tokenize.OP and previous.string in {"(", "[", ","}:
            continue
        if current.type == tokenize.OP and current.string == "[" and previous.type == tokenize.NAME:
            continue
        inserts.append(line_starts[previous.end[0] - 1] + previous.end[1])
    for index in reversed(inserts):
        source = source[:index] + "*" + source[index:]
    return source


def _normalize_source(source: str, function_names: set[str]) -> str:
    source = re.sub(r"(\[[^\[\]]+\]|\b[A-Za-z_]\w*\b|\([^()]+\))\s*\^\s*\(?T\)?(?![A-Za-z0-9_])", r"transpose(\1)", source)
    source = _matrix_rows(source)
    source = _implicit_products(source, function_names | set(_FUNCTIONS) | set(_MATRIX_FUNCTIONS))
    source = re.sub(r"(?<![<>!=])=(?!=)", "==", source)
    return source.replace("^", "**")


def _as_matrix(value, operation: str) -> sp.MatrixBase:
    if not isinstance(value, sp.MatrixBase):
        raise ExpressionError(f"{operation} requires a vector or matrix.")
    return value


def _square(matrix: sp.MatrixBase, operation: str) -> None:
    if matrix.rows != matrix.cols:
        raise ExpressionError(f"{operation} requires a square matrix; received {matrix.rows}×{matrix.cols}.")


def _vector_values(matrix: sp.MatrixBase, operation: str) -> list[sp.Expr]:
    if matrix.rows != 1 and matrix.cols != 1:
        raise ExpressionError(f"{operation} requires a row or column vector.")
    return list(matrix)


def _matrix_operation(name: str, args: list):
    if name == "transpose":
        _arity(name, args, 1)
        return _as_matrix(args[0], name).T
    if name in {"det", "inverse", "trace"}:
        _arity(name, args, 1)
        matrix = _as_matrix(args[0], name)
        _square(matrix, name)
        if name == "det":
            return sp.factor(matrix.det())
        if name == "trace":
            return sp.simplify(matrix.trace())
        try:
            return matrix.inv()
        except (ValueError, ZeroDivisionError, sp.matrices.exceptions.NonInvertibleMatrixError) as error:
            raise ExpressionError("This matrix is singular and has no inverse.") from error
    if name in {"dot", "cross"}:
        _arity(name, args, 2)
        left, right = (_vector_values(_as_matrix(value, name), name) for value in args)
        if len(left) != len(right):
            raise ExpressionError(f"{name} requires vectors of equal length.")
        if name == "cross" and len(left) != 3:
            raise ExpressionError("cross requires two three-dimensional vectors.")
        if name == "dot":
            return sp.Add(*(a * b for a, b in zip(left, right)))
        return sp.Matrix(1, 3, left).cross(sp.Matrix(1, 3, right))
    if name in {"norm", "normalize"}:
        _arity(name, args, 1)
        vector = _as_matrix(args[0], name)
        values = _vector_values(vector, name)
        length = sp.sqrt(sp.Add(*(sp.conjugate(item) * item for item in values)))
        if name == "norm":
            return sp.simplify(length)
        if length == 0:
            raise ExpressionError("The zero vector cannot be normalized.")
        return vector / length
    if name == "entry":
        _arity(name, args, 3)
        matrix = _as_matrix(args[0], name)
        row, column = args[1:]
        if not row.is_Integer or not column.is_Integer or not (1 <= int(row) <= matrix.rows and 1 <= int(column) <= matrix.cols):
            raise ExpressionError("Matrix row and column indices must be valid positive integers.")
        return matrix[int(row) - 1, int(column) - 1]
    raise ExpressionError(f"Unsupported operation: {name}.")


_MATRIX_FUNCTIONS = {"transpose", "det", "inverse", "trace", "dot", "cross", "norm", "normalize", "entry"}


def _arity(name: str, args: list, count: int) -> None:
    if len(args) != count:
        raise ExpressionError(f"{name} expects {count} argument(s).")


def parse_expression(source: str, variables: dict[str, object] | None = None,
                     functions: dict[str, tuple[tuple[sp.Symbol, ...], object]] | None = None,
                     local_symbols: set[str] | None = None):
    if not isinstance(source, str) or not source.strip():
        raise ExpressionError("Expression cannot be empty.")
    if len(source) > 8_000:
        raise ExpressionError("Expression is too long (maximum 8000 characters).")
    variables = variables or {}
    functions = functions or {}
    function_names = set(functions)
    try:
        tree = ast.parse(_normalize_source(source, function_names), mode="eval")
        return _convert(tree.body, variables, functions, local_symbols or set())
    except (SyntaxError, RecursionError) as error:
        raise ExpressionError("Expression syntax is not valid.") from error
    except (TypeError, ValueError, OverflowError) as error:
        if isinstance(error, ExpressionError):
            raise
        raise ExpressionError(str(error)) from error


def _convert(node: ast.AST, variables: dict[str, object],
             functions: dict[str, tuple[tuple[sp.Symbol, ...], object]], local_symbols: set[str]):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        if isinstance(node.value, float) and not (float("-inf") < node.value < float("inf")):
            raise ExpressionError("Number must be finite.")
        return sp.Integer(node.value) if isinstance(node.value, int) else sp.Float(node.value)
    if isinstance(node, ast.Name):
        if node.id in local_symbols:
            return sp.Symbol(node.id)
        if node.id in variables:
            return variables[node.id]
        if node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        if node.id.isidentifier() and not node.id.startswith("__"):
            return sp.Symbol(node.id)
        raise ExpressionError(f"Unsupported name: {node.id}")
    if isinstance(node, ast.List):
        rows = node.elts if node.elts and all(isinstance(row, ast.List) for row in node.elts) else [node]
        values = [[_convert(item, variables, functions, local_symbols) for item in row.elts] for row in rows]
        if not values or not values[0] or any(len(row) != len(values[0]) for row in values):
            raise ExpressionError("Every matrix row must contain the same positive number of entries.")
        try:
            return sp.Matrix(values)
        except (TypeError, ValueError) as error:
            raise ExpressionError("Matrix entries must be mathematical expressions.") from error
    if isinstance(node, ast.Subscript):
        matrix = _as_matrix(_convert(node.value, variables, functions, local_symbols), "Component access")
        if isinstance(node.slice, ast.Tuple) and len(node.slice.elts) == 2:
            row, column = (_convert(item, variables, functions, local_symbols) for item in node.slice.elts)
        else:
            index = _convert(node.slice, variables, functions, local_symbols)
            if matrix.rows == 1:
                row, column = sp.Integer(1), index
            elif matrix.cols == 1:
                row, column = index, sp.Integer(1)
            else:
                raise ExpressionError("Use two indices to access an entry of a matrix.")
        if not getattr(row, "is_Integer", False) or not getattr(column, "is_Integer", False) or not (1 <= int(row) <= matrix.rows and 1 <= int(column) <= matrix.cols):
            raise ExpressionError("Matrix indices are 1-based positive integers within the matrix dimensions.")
        return matrix[int(row) - 1, int(column) - 1]
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        try:
            left = _convert(node.left, variables, functions, local_symbols)
            right = _convert(node.right, variables, functions, local_symbols)
            if type(node.op) is ast.Mult and isinstance(left, sp.MatrixBase) and isinstance(right, sp.MatrixBase):
                left_vector = left.rows == 1 or left.cols == 1
                right_vector = right.rows == 1 or right.cols == 1
                if left_vector and right_vector and left.cols != right.rows:
                    raise ExpressionError("Multiplying two vector expressions is ambiguous; use dot(a,b) or cross(a,b).")
            return _BINARY[type(node.op)](left, right)
        except ShapeError as error:
            raise ExpressionError("Matrix dimensions are incompatible for this operation.") from error
        except (TypeError, ValueError, ZeroDivisionError) as error:
            if isinstance(error, ExpressionError):
                raise
            raise ExpressionError("These mathematical objects cannot be combined with that operation.") from error
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_convert(node.operand, variables, functions, local_symbols))
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and len(node.comparators) == 1:
        comparisons = {ast.Lt: sp.Lt, ast.LtE: sp.Le, ast.Gt: sp.Gt, ast.GtE: sp.Ge, ast.Eq: sp.Eq, ast.NotEq: sp.Ne}
        operation = comparisons.get(type(node.ops[0]))
        if operation is None:
            raise ExpressionError("Only ordinary comparison operators are supported in conditions.")
        return operation(_convert(node.left, variables, functions, local_symbols),
                         _convert(node.comparators[0], variables, functions, local_symbols))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
        name = node.func.id
        args = [_convert(argument, variables, functions, local_symbols) for argument in node.args]
        if name == "piecewise":
            if len(args) < 3 or len(args) % 2 == 0:
                raise ExpressionError("piecewise expects alternating value/condition pairs and a final default value.")
            branches = [(args[index], args[index + 1]) for index in range(0, len(args) - 1, 2)]
            if any(not isinstance(condition, (sp.logic.boolalg.Boolean,)) for _, condition in branches):
                raise ExpressionError("Each piecewise condition must be a comparison.")
            return sp.Piecewise(*branches, (args[-1], True))
        if name in _FUNCTIONS:
            function, arity = _FUNCTIONS[name]
            _arity(name, args, arity)
            return function(*args)
        if name in _MATRIX_FUNCTIONS:
            return _matrix_operation(name, args)
        if name in functions:
            parameters, body = functions[name]
            if len(args) != len(parameters):
                raise ExpressionError(f"{name} expects {len(parameters)} argument(s), received {len(args)}.")
            return body.subs(dict(zip(parameters, args)), simultaneous=True)
        raise ExpressionError(f"Undefined function: {name}.")
    raise ExpressionError("Use numbers, variables, vectors, matrices, +, -, *, /, ^, parentheses, and supported functions.")


def _contains_name(source: str, name: str) -> bool:
    try:
        tree = ast.parse(_normalize_source(source, set(_FUNCTIONS)), mode="eval")
    except (SyntaxError, RecursionError):
        return False
    return any((isinstance(node, ast.Name) and node.id == name)
               or (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name)
               for node in ast.walk(tree))


def parse_definition(source: str, variables: dict[str, object],
                     functions: dict[str, tuple[tuple[sp.Symbol, ...], object]]):
    equals = top_level_equals(source)
    if equals < 0:
        return None
    if top_level_equals(source[equals + 1:]) >= 0:
        raise ExpressionError("Use one equals sign in an assignment.")
    function_match = _FUNCTION_DEFINITION.fullmatch(source)
    if function_match:
        name, parameter_text, body_source = function_match.groups()
        _validate_definition_name(name)
        parameters = tuple(item.strip() for item in parameter_text.split(","))
        if not parameters or len(parameters) > _FUNCTION_ARGUMENT_LIMIT:
            raise ExpressionError(f"Functions must have between 1 and {_FUNCTION_ARGUMENT_LIMIT} arguments.")
        if any(not _IDENTIFIER.fullmatch(item) for item in parameters) or len(set(parameters)) != len(parameters) or any(item.startswith("__") for item in parameters):
            raise ExpressionError("Function parameters must be distinct identifiers (letters, digits, underscores) separated by commas.")
        if any(item in _CONSTANTS or item in _FUNCTIONS or item in _MATRIX_FUNCTIONS for item in parameters):
            raise ExpressionError("Function parameters cannot redefine mathematical constants or built-in functions.")
        if _contains_name(body_source, name):
            raise ExpressionError(f"Circular function dependency detected for {name}.")
        symbols = tuple(sp.Symbol(item) for item in parameters)
        body = parse_expression(body_source, variables, functions, set(parameters))
        allowed = set(parameters) | set(variables)
        undefined = sorted(symbol.name for symbol in getattr(body, "free_symbols", set()) if symbol.name not in allowed)
        if undefined:
            raise ExpressionError("Undefined variable(s) in function definition: " + ", ".join(undefined) + ".")
        functions[name] = (symbols, body)
        variables.pop(name, None)
        return f"{name}({', '.join(parameters)})", (symbols, body)
    left, right = source[:equals].strip(), source[equals + 1:].strip()
    if not _IDENTIFIER.fullmatch(left):
        raise ExpressionError("Assignments must use the form name = expression.")
    _validate_definition_name(left)
    if _contains_name(right, left):
        raise ExpressionError(f"Circular variable dependency detected for {left}.")
    value = parse_expression(right, variables, functions)
    variables[left] = value
    functions.pop(left, None)
    return left, value


def _validate_definition_name(name: str) -> None:
    if name in _CONSTANTS or name in _FUNCTIONS or name in _MATRIX_FUNCTIONS or name.startswith("__"):
        raise ExpressionError(f"Cannot redefine reserved name: {name}.")


def notebook_environment(context: list[str] | None = None):
    if context is None:
        context = []
    if not isinstance(context, list) or len(context) > _FUNCTIONS_CONTEXT_LIMIT or any(not isinstance(item, str) or len(item) > 8_000 for item in context):
        raise ExpressionError("Notebook definition context is invalid or too large.")
    variables: dict[str, object] = {}
    functions: dict[str, tuple[tuple[sp.Symbol, ...], object]] = {}
    for source in context:
        equals = top_level_equals(source)
        if equals >= 0:
            left = source[:equals].strip()
            if not (_IDENTIFIER.fullmatch(left) or _FUNCTION_DEFINITION.fullmatch(source)):
                continue
            try:
                parse_definition(source, variables, functions)
            except ExpressionError as error:
                raise ExpressionError(f"A previous notebook definition is invalid: {error}") from error
    return variables, functions


def parse_notebook_expression(source: str, context: list[str] | None = None):
    variables, functions = notebook_environment(context)
    return parse_expression(source, variables, functions)
