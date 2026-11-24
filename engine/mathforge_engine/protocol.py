"""Request dispatch and JSON Lines protocol implementation."""

import json
import sys
from typing import Any

from . import __version__
from .expressions import ExpressionError
from .symbolic import simplify


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    if not isinstance(request_id, (str, int)):
        return {"id": "", "ok": False, "error": {"code": "invalid_request", "message": "A string or integer request id is required."}}
    try:
        operation = request.get("operation")
        if operation == "health":
            result = {"status": "ok", "version": __version__, "capabilities": ["symbolic.simplify"]}
        elif operation == "symbolic.simplify":
            expression = request.get("expression")
            if not isinstance(expression, str):
                raise ExpressionError("Field 'expression' must be a string.")
            result = simplify(expression)
        else:
            return {"id": str(request_id), "ok": False, "error": {"code": "unknown_operation", "message": f"Unsupported operation: {operation}"}}
        return {"id": str(request_id), "ok": True, "result": result}
    except ExpressionError as error:
        return {"id": str(request_id), "ok": False, "error": {"code": "invalid_expression", "message": str(error)}}
    except Exception:
        return {"id": str(request_id), "ok": False, "error": {"code": "calculation_error", "message": "The symbolic operation could not be completed."}}


def serve(input_stream=sys.stdin, output_stream=sys.stdout) -> None:
    for line in input_stream:
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Request must be a JSON object.")
            response = dispatch(request)
        except (json.JSONDecodeError, ValueError) as error:
            response = {"id": "", "ok": False, "error": {"code": "invalid_request", "message": str(error)}}
        output_stream.write(json.dumps(response, separators=(",", ":")) + "\n")
        output_stream.flush()
