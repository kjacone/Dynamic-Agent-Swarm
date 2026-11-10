"""Safe expression evaluator + templating (no eval/exec).

Used by workflow conditions, policy ``when`` clauses and ``{{ template }}`` inputs.
Only a small, side-effect-free subset of Python expressions is supported.
"""
from __future__ import annotations

import ast
import operator as op
import re
from typing import Any

_BIN = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv, ast.Mod: op.mod}
_CMP = {
    ast.Eq: op.eq, ast.NotEq: op.ne, ast.Lt: op.lt, ast.LtE: op.le, ast.Gt: op.gt, ast.GtE: op.ge,
    ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
    ast.Is: op.is_, ast.IsNot: op.is_not,
}
def parse_json(text):
    """Tolerant JSON extraction from model output (handles ```json fences and chatter)."""
    import json as _j
    if isinstance(text, (dict, list)):
        return text
    if not isinstance(text, str):
        return None
    for cand in (text.strip(), text[text.find("{"): text.rfind("}") + 1], text[text.find("["): text.rfind("]") + 1]):
        try:
            return _j.loads(cand)
        except ValueError:
            continue
    return None


_FUNCS = {"parse_json": parse_json, "len": len, "abs": abs, "min": min, "max": max, "round": round,
          "int": int, "float": float, "str": str, "bool": bool, "sum": sum}
_METHODS = {"lower", "upper", "strip", "startswith", "endswith", "get"}


class ExprError(ValueError):
    pass


def safe_eval(expr: str, env: dict[str, Any]) -> Any:
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise ExprError(f"Bad expression {expr!r}: {e.msg}") from e
    return _ev(tree.body, env)


def _ev(n: ast.AST, env: dict[str, Any]) -> Any:  # noqa: C901 - flat dispatcher
    if isinstance(n, ast.Constant):
        return n.value
    if isinstance(n, ast.Name):
        if n.id in ("true", "True"):
            return True
        if n.id in ("false", "False"):
            return False
        if n.id in ("null", "None"):
            return None
        return env.get(n.id)
    if isinstance(n, ast.Attribute):
        base = _ev(n.value, env)
        return base.get(n.attr) if isinstance(base, dict) else None
    if isinstance(n, ast.Subscript):
        base, key = _ev(n.value, env), _ev(n.slice, env)
        try:
            return base[key]
        except (KeyError, IndexError, TypeError):
            return None
    if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
        return [_ev(e, env) for e in n.elts]
    if isinstance(n, ast.Dict):
        return {_ev(k, env): _ev(v, env) for k, v in zip(n.keys, n.values) if k is not None}
    if isinstance(n, ast.BoolOp):
        vals = (_ev(v, env) for v in n.values)
        return all(vals) if isinstance(n.op, ast.And) else any(vals)
    if isinstance(n, ast.UnaryOp):
        v = _ev(n.operand, env)
        if isinstance(n.op, ast.Not):
            return not v
        if isinstance(n.op, ast.USub):
            return -v
        raise ExprError("Unsupported unary operator")
    if isinstance(n, ast.BinOp) and type(n.op) in _BIN:
        try:
            return _BIN[type(n.op)](_ev(n.left, env), _ev(n.right, env))
        except (TypeError, ZeroDivisionError):
            return None
    if isinstance(n, ast.Compare):
        left = _ev(n.left, env)
        for o, comp in zip(n.ops, n.comparators):
            right = _ev(comp, env)
            fn = _CMP.get(type(o))
            if fn is None:
                raise ExprError("Unsupported comparison")
            try:
                if not fn(left, right):
                    return False
            except TypeError:
                return False  # e.g. None > 5 -> False, never crash a workflow
            left = right
        return True
    if isinstance(n, ast.IfExp):
        return _ev(n.body, env) if _ev(n.test, env) else _ev(n.orelse, env)
    if isinstance(n, ast.Call) and not n.keywords:
        args = [_ev(a, env) for a in n.args]
        if isinstance(n.func, ast.Name) and n.func.id in _FUNCS:
            try:
                return _FUNCS[n.func.id](*args)
            except (TypeError, ValueError):
                return None
        if isinstance(n.func, ast.Attribute) and n.func.attr in _METHODS:
            target = _ev(n.func.value, env)
            if isinstance(target, (str, dict)):
                return getattr(target, n.func.attr)(*args)
    raise ExprError(f"Unsupported expression element: {type(n).__name__}")


_TPL = re.compile(r"\{\{\s*(.+?)\s*\}\}")


def render(value: Any, env: dict[str, Any]) -> Any:
    """Recursively render ``{{ expr }}`` in strings/lists/dicts. A string that is exactly
    one template keeps the native type of the result."""
    if isinstance(value, str):
        m = _TPL.fullmatch(value.strip())
        if m:
            return safe_eval(m.group(1), env)
        return _TPL.sub(lambda mm: "" if (r := safe_eval(mm.group(1), env)) is None else str(r), value)
    if isinstance(value, list):
        return [render(v, env) for v in value]
    if isinstance(value, dict):
        return {k: render(v, env) for k, v in value.items()}
    return value
