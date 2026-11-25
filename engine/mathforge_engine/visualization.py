"""Bounded numerical visualizations using only the restricted SymPy parser."""
from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import sympy as sp

from .expressions import ExpressionError, notebook_environment, parse_definition, parse_expression, top_level_equals


def visualize(operation: str, source: str, options: dict[str, Any] | None = None, context: list[str] | None = None) -> dict[str, Any]:
    if not isinstance(source, str) or not source.strip() or len(source) > 8_000:
        raise ExpressionError("Enter a visualization expression no longer than 8000 characters.")
    options = options if isinstance(options, dict) else {}
    variables, functions = notebook_environment(context)
    if operation == "visualize.graph2d":
        return graph2d(source, options, variables, functions)
    if operation == "visualize.complexPlane":
        return complex_plane(source, options, variables, functions)
    if operation == "visualize.graph3d":
        return graph3d(source, options, variables, functions)
    raise ExpressionError(f"Unsupported visualization operation: {operation}.")


def _lines(source: str) -> list[str]:
    lines: list[str] = []
    current: list[str] = []
    square_depth = paren_depth = 0
    for char in source:
        if char == "[": square_depth += 1
        elif char == "]": square_depth = max(0, square_depth - 1)
        elif char == "(": paren_depth += 1
        elif char == ")": paren_depth = max(0, paren_depth - 1)
        if char == "\n" or (char == ";" and square_depth == 0 and paren_depth == 0):
            line = "".join(current).strip()
            if line: lines.append(line)
            current = []
        else:
            current.append(char)
    final_line = "".join(current).strip()
    if final_line: lines.append(final_line)
    if not lines or len(lines) > 12:
        raise ExpressionError("A visualization can contain between 1 and 12 expressions.")
    return lines


def _equation(source: str, variables=None, functions=None) -> tuple[str | None, sp.Expr]:
    equals = top_level_equals(source)
    if equals < 0:
        return None, parse_expression(source, variables, functions)
    if top_level_equals(source[equals + 1:]) >= 0:
        raise ExpressionError("Use one equals sign per equation.")
    left, right = source[:equals].strip(), source[equals + 1:].strip()
    if not left or not right:
        raise ExpressionError("Complete both sides of the equation.")
    return left, parse_expression(left, variables, functions) - parse_expression(right, variables, functions)


def _validate_symbols(expression: sp.Expr, allowed: set[str]) -> None:
    unsupported = sorted(symbol.name for symbol in expression.free_symbols if symbol.name not in allowed)
    if unsupported:
        raise ExpressionError("Unsupported variable(s) for this view: " + ", ".join(unsupported) + ".")


def _range(options: dict[str, Any], name: str, default: tuple[float, float]) -> tuple[float, float]:
    value = options.get(name, default)
    if (not isinstance(value, (list, tuple)) or len(value) != 2
            or any(not isinstance(part, (int, float)) or not math.isfinite(part) or abs(part) > 1_000_000 for part in value)
            or value[0] >= value[1]):
        raise ExpressionError(f"{name} must be finite and increasing within ±1,000,000.")
    return float(value[0]), float(value[1])


def _callable(expression: sp.Expr, symbols: list[sp.Symbol]):
    try:
        # The input tree has already passed parse_expression's strict AST allowlist.
        return sp.lambdify(symbols, expression, modules="numpy", dummify=True, cse=True)
    except (TypeError, ValueError, SyntaxError) as error:
        raise ExpressionError("This expression cannot be sampled numerically.") from error


def _finite(value: Any, shape: tuple[int, ...]) -> np.ndarray:
    try:
        values = np.broadcast_to(np.asarray(value, dtype=np.complex128), shape)
        if np.any(np.abs(values.imag[np.isfinite(values.imag)]) > 1e-10):
            raise ExpressionError("This view requires real-valued samples.")
        real = values.real.astype(np.float64, copy=False)
        return np.where(np.isfinite(real) & (np.abs(real) < 1e12), real, np.nan)
    except (TypeError, ValueError, OverflowError, FloatingPointError) as error:
        if isinstance(error, ExpressionError):
            raise
        raise ExpressionError("The expression is undefined or unstable in this range.") from error


def _sample(function, *arguments):
    with np.errstate(all="ignore"):
        return function(*arguments)


def _rows(values: np.ndarray) -> list[list[float | None]]:
    return [[float(value) if np.isfinite(value) else None for value in row] for row in values]


def graph2d(source: str, options: dict[str, Any], variables=None, functions=None) -> dict[str, Any]:
    x_min, x_max = _range(options, "xRange", (-10, 10))
    y_min, y_max = _range(options, "yRange", (-10, 10))
    samples = options.get("samples", 401)
    if not isinstance(samples, int) or isinstance(samples, bool) or not 40 <= samples <= 1000:
        raise ExpressionError("2D sampling must be between 40 and 1000 points.")
    sx, sy = sp.Symbol("x"), sp.Symbol("y")
    x = np.linspace(x_min, x_max, samples)
    output = []
    for line in _lines(source):
        direct_function = re.fullmatch(r"\s*([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)\s*=\s*(.+?)\s*", line)
        if direct_function:
            name = direct_function.group(1)
            parameters = [parameter.strip() for parameter in direct_function.group(2).split(",")]
            if len(parameters) > 2:
                raise ExpressionError("A 2D plot accepts one input for a function or two inputs for an implicit contour.")
            parse_definition(line, variables, functions)
            arguments = "x" if len(parameters) == 1 else "x,y"
            expression = parse_expression(f"{name}({arguments})", variables, functions)
            left = None
        else:
            left, expression = _equation(line, variables, functions)
        if left == "y":
            expression = sp.Symbol("y") - expression
            # y was moved to the left by equation parsing; recover the function side.
        if left == "y" or (left is None and expression.free_symbols <= {sx}):
            _validate_symbols(expression, {"x"})
            values = _finite(_sample(_callable(expression, [sx]), x), x.shape)
            values[(values < y_min) | (values > y_max)] = np.nan
            points = [[float(a), None if not np.isfinite(b) else float(b)] for a, b in zip(x, values)]
            threshold, previous = (y_max - y_min) * 0.35, None
            for point in points:
                if point[1] is None or (previous is not None and abs(point[1] - previous) > threshold):
                    point[1] = None
                previous = point[1]
            output.append({"kind": "function", "label": line, "points": points})
        else:
            _validate_symbols(expression, {"x", "y"})
            count = min(200, max(80, int(math.sqrt(samples) * 5)))
            gx, gy = np.linspace(x_min, x_max, count), np.linspace(y_min, y_max, count)
            xx, yy = np.meshgrid(gx, gy)
            values = _finite(_sample(_callable(expression, [sx, sy]), xx, yy), xx.shape)
            output.append({"kind": "implicit", "label": line, "x": gx.tolist(), "y": gy.tolist(), "values": _rows(values)})
    return {"kind": "graph2d", "series": output, "approximate": True, "warning": "Numerical visualization: sampled graph values are approximate."}


def complex_plane(source: str, options: dict[str, Any], variables=None, functions=None) -> dict[str, Any]:
    rr = _range(options, "realRange", (-10, 10))
    ir = _range(options, "imaginaryRange", (-10, 10))
    precision = options.get("precision", 30)
    if not isinstance(precision, int) or isinstance(precision, bool) or not 10 <= precision <= 100:
        raise ExpressionError("Precision must be between 10 and 100 digits.")
    points = []
    complete = True
    for line in _lines(source):
        left, expression = _equation(line, variables, functions)
        if left is not None:
            variables = list(expression.free_symbols)
            if len(variables) != 1:
                raise ExpressionError("A complex equation must have exactly one variable.")
            try:
                sp.Poly(expression, variables[0])
            except sp.PolynomialError:
                complete = False
            try:
                roots = sp.solve(sp.Eq(expression, 0), variables[0])
            except (NotImplementedError, ValueError, sp.PolynomialError) as error:
                raise ExpressionError("This equation could not be solved symbolically.") from error
            if not isinstance(roots, list) or len(roots) > 100:
                raise ExpressionError("This equation's solution set is too broad to plot.")
            for root in roots:
                points.append(_point(root, sp.sstr(root), precision, rr, ir))
        else:
            if expression.free_symbols:
                raise ExpressionError("Enter a complex value or an equation such as x^2+1=0.")
            exact = sp.simplify(expression)
            points.append(_point(exact, sp.sstr(exact), precision, rr, ir))
    warning = "Coordinates are numerical approximations; exact values are shown in labels."
    if not complete:
        warning += " Periodic or infinite solution sets may be only partially represented."
    return {"kind": "complexPlane", "points": points, "approximate": True, "solutionSetComplete": complete, "warning": warning}


def _point(value: sp.Expr, exact: str, precision: int, rr: tuple[float, float], ir: tuple[float, float]):
    try:
        real, imaginary = sp.expand_complex(sp.N(value, precision)).as_real_imag()
        x, y = float(real), float(imaginary)
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError("nonfinite")
    except (TypeError, ValueError, OverflowError) as error:
        raise ExpressionError("A finite complex coordinate could not be calculated.") from error
    return {"exact": exact, "real": x, "imaginary": y, "visible": rr[0] <= x <= rr[1] and ir[0] <= y <= ir[1]}


def graph3d(source: str, options: dict[str, Any], variables=None, functions=None) -> dict[str, Any]:
    xr, yr, zr = (_range(options, key, (-10, 10)) for key in ("xRange", "yRange", "zRange"))
    resolution = options.get("resolution", 24)
    if not isinstance(resolution, int) or isinstance(resolution, bool) or not 8 <= resolution <= 32:
        raise ExpressionError("3D resolution must be between 8 and 32.")
    lines = _lines(source)
    vector_kind = _vector_kind(lines)
    if vector_kind:
        return vector3d(lines, vector_kind, options, xr, yr, zr, resolution, variables, functions)
    if len(lines) == 1:
        function_definition = re.fullmatch(r"\s*([A-Za-z_]\w*)\s*\(([^()]*)\)\s*=\s*(.+?)\s*", lines[0])
        if function_definition:
            name, parameter_text, _ = function_definition.groups()
            parameters = [parameter.strip() for parameter in parameter_text.split(",")]
            if len(parameters) not in {2, 3}:
                raise ExpressionError("A 3D function plot requires two inputs for a surface or three for an implicit surface.")
            parse_definition(lines[0], variables, functions)
            arguments = "x,y" if len(parameters) == 2 else "x,y,z"
            expression = parse_expression(f"{name}({arguments})", variables, functions)
            sx, sy, sz = sp.Symbol("x"), sp.Symbol("y"), sp.Symbol("z")
            xs, ys = np.linspace(*xr, resolution), np.linspace(*yr, resolution)
            if len(parameters) == 2:
                _validate_symbols(expression, {"x", "y"})
                xx, yy = np.meshgrid(xs, ys)
                values = _finite(_sample(_callable(expression, [sx, sy]), xx, yy), xx.shape)
                values[(values < zr[0]) | (values > zr[1])] = np.nan
                return {"kind": "surface3d", "x": xs.tolist(), "y": ys.tolist(), "z": _rows(values), "approximate": True,
                        "warning": "Numerical visualization: this sampled function surface is approximate."}
            _validate_symbols(expression, {"x", "y", "z"})
            zs = np.linspace(*zr, resolution)
            xx, yy, zz = np.meshgrid(xs, ys, zs, indexing="ij")
            values = _finite(_sample(_callable(expression, [sx, sy, sz]), xx, yy, zz), xx.shape)
            volume = [[[float(value) if np.isfinite(value) else None for value in row] for row in plane] for plane in values]
            return {"kind": "implicit3d", "x": xs.tolist(), "y": ys.tolist(), "z": zs.tolist(), "values": volume,
                    "approximate": True, "warning": "Numerical visualization: this implicit function is sampled within the selected ranges."}
    if len(lines) == 1:
        try:
            vector = parse_expression(lines[0], variables, functions)
        except ExpressionError:
            vector = None
        if isinstance(vector, sp.MatrixBase) and (vector.rows == 1 or vector.cols == 1):
            components = list(vector)
            if len(components) != 3:
                raise ExpressionError("A 3D vector must contain exactly three components.")
            if any(component.free_symbols for component in components):
                raise ExpressionError("Define every variable in the 3D vector before plotting it.")
            exact = [sp.sstr(component) for component in components]
            coordinates = []
            for component in components:
                numeric = sp.N(component, 20)
                if numeric.is_real is not True or not math.isfinite(float(numeric)):
                    raise ExpressionError("A 3D vector requires finite real components.")
                coordinates.append(float(numeric))
            return {"kind": "vector3d", "vectors": [coordinates], "exactVectors": [exact], "approximate": True,
                    "warning": "Vector coordinates are numerical samples; exact components are retained."}
    if len(lines) != 1:
        raise ExpressionError("3D surface mode currently accepts one expression at a time.")
    left, expression = _equation(lines[0], variables, functions)
    sx, sy, sz = sp.Symbol("x"), sp.Symbol("y"), sp.Symbol("z")
    xs, ys = np.linspace(*xr, resolution), np.linspace(*yr, resolution)
    if left == "z":
        expression = sp.Symbol("z") - expression
    if left == "z" or (left is None and expression.free_symbols <= {sx, sy}):
        _validate_symbols(expression, {"x", "y"})
        xx, yy = np.meshgrid(xs, ys)
        values = _finite(_sample(_callable(expression, [sx, sy]), xx, yy), xx.shape)
        values[(values < zr[0]) | (values > zr[1])] = np.nan
        return {"kind": "surface3d", "x": xs.tolist(), "y": ys.tolist(), "z": _rows(values), "approximate": True,
                "warning": "Numerical visualization: this sampled surface is approximate."}
    _validate_symbols(expression, {"x", "y", "z"})
    zs = np.linspace(*zr, resolution)
    xx, yy, zz = np.meshgrid(xs, ys, zs, indexing="ij")
    values = _finite(_sample(_callable(expression, [sx, sy, sz]), xx, yy, zz), xx.shape)
    volume = [[[float(value) if np.isfinite(value) else None for value in row] for row in plane] for plane in values]
    return {"kind": "implicit3d", "x": xs.tolist(), "y": ys.tolist(), "z": zs.tolist(), "values": volume,
            "approximate": True, "warning": "Numerical visualization: this implicit surface is sampled within the selected ranges."}


def _vector_kind(lines: list[str]) -> str | None:
    if all(re.fullmatch(r"\s*[A-Za-z_]\w*\s*\(\s*x\s*,\s*y\s*,\s*z\s*\)\s*=.*", line) for line in lines):
        return "field3d"
    if len(lines) == 1 and re.fullmatch(r"\s*[A-Za-z_]\w*\s*\(\s*t\s*\)\s*=.*", lines[0]):
        return "curve3d"
    if all(re.search(r"(?<![A-Za-z])(?:[ijk])(?![A-Za-z])", line) for line in lines):
        return "vector3d"
    return None


def _vector_expression(source: str, variables, functions, local_symbols: set[str]):
    basis = {
        "_basis_i": sp.Matrix([1, 0, 0]),
        "_basis_j": sp.Matrix([0, 1, 0]),
        "_basis_k": sp.Matrix([0, 0, 1]),
    }
    normalized = re.sub(r"(?<![A-Za-z0-9_])([ijk])(?![A-Za-z0-9_])", lambda match: "_basis_" + match.group(1), source)
    return parse_expression(normalized, {**variables, **basis}, functions, local_symbols)


def _vector_components(value, description: str) -> list[sp.Expr]:
    if not isinstance(value, sp.MatrixBase) or (value.rows != 1 and value.cols != 1) or len(value) != 3:
        raise ExpressionError(f"{description} must be a row or column vector with three components.")
    return list(value)


def vector3d(lines: list[str], kind: str, options: dict[str, Any], xr: tuple[float, float], yr: tuple[float, float], zr: tuple[float, float], resolution: int, variables, functions) -> dict[str, Any]:
    vectors: list[list[float]] = []
    exact: list[list[str]] = []
    parameter_range = options.get("parameterRange", [0, 6.283185307179586])
    if (not isinstance(parameter_range, (list, tuple)) or len(parameter_range) != 2
            or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in parameter_range)
            or parameter_range[0] >= parameter_range[1] or abs(parameter_range[0]) > 1e6 or abs(parameter_range[1]) > 1e6):
        raise ExpressionError("The parameter range must be finite and increasing.")
    if kind == "vector3d":
        for line in lines:
            vector = _vector_components(_vector_expression(line, variables, functions, set()), "A 3D vector")
            if any(item.free_symbols for item in vector):
                raise ExpressionError("An individual vector must have three constant components.")
            exact.append([sp.sstr(item) for item in vector])
            vectors.append([float(sp.N(item, 20)) for item in vector])
        return {"kind": kind, "vectors": vectors, "exactVectors": exact, "approximate": True,
                "warning": "Vector coordinates are numerical samples; exact components are retained."}
    if kind == "curve3d":
        _, rhs = lines[0].split("=", 1)
        symbol = sp.Symbol("t")
        vector = _vector_components(_vector_expression(rhs, variables, functions, {"t"}), "A parametric curve")
        if any(not item.free_symbols <= {symbol} for item in vector):
            raise ExpressionError("A parametric curve must use t as its only variable.")
        callables = [_callable(item, [symbol]) for item in vector]
        for value in np.linspace(float(parameter_range[0]), float(parameter_range[1]), min(500, resolution * 8)):
            point = [float(_sample(fn, value)) for fn in callables]
            vectors.append(point if all(math.isfinite(item) and abs(item) < 1e12 for item in point) else [float("nan")] * 3)
        curve = [[None if not math.isfinite(value) else value for value in point] for point in vectors]
        return {"kind": kind, "curve": curve, "approximate": True, "warning": "The parametric curve is a numerical sample over the selected t range."}
    _, rhs = lines[0].split("=", 1)
    vector = _vector_components(_vector_expression(rhs, variables, functions, {"x", "y", "z"}), "A vector field")
    allowed = {sp.Symbol("x"), sp.Symbol("y"), sp.Symbol("z")}
    if any(not item.free_symbols <= allowed for item in vector):
        raise ExpressionError("A vector field must use x, y, z as its only variables.")
    variables = [sp.Symbol("x"), sp.Symbol("y"), sp.Symbol("z")]
    callables = [_callable(item, variables) for item in vector]
    density = min(8, max(3, resolution // 4))
    coordinates = [np.linspace(*interval, density) for interval in (xr, yr, zr)]
    for x in coordinates[0]:
        for y in coordinates[1]:
            for z in coordinates[2]:
                components = [float(_sample(fn, x, y, z)) for fn in callables]
                if all(math.isfinite(value) and abs(value) < 1e12 for value in components):
                    vectors.append([float(x), float(y), float(z), *components])
    return {"kind": kind, "vectors": vectors, "approximate": True, "warning": "Vector-field arrows are numerical samples on a bounded grid."}
