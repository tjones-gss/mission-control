"""Zero-dependency YAML subset parser.

Supports the narrow subset we use inside .oversight/:
  - scalar values (str / int / float / bool / null / empty)
  - block mappings (nested)
  - block sequences with "- item" or "- key: value"
  - single-line flow-style "[a, b]" and "{}" (empty)
  - "#" comments, blank lines
  - quoted strings (single or double) are unquoted
  - block scalars:  |   (literal, newlines preserved)
                    |-  (literal, trailing newlines stripped)
                    >   (folded, newlines -> single space)

This is intentionally NOT a full YAML parser. Keep manifest.yaml / domains/*.yaml
within this subset. If you need more, install pyyaml and replace this module.
"""

from __future__ import annotations

import re
from typing import Any


def _strip_quotes(v: str) -> str:
    if len(v) >= 2 and v[0] == v[-1] and v[0] == "'":
        # YAML single-quoted: '' -> '
        return v[1:-1].replace("''", "'")
    if len(v) >= 2 and v[0] == v[-1] and v[0] == '"':
        # YAML double-quoted: interpret \n \t \" \\
        body = v[1:-1]
        out: list[str] = []
        i = 0
        while i < len(body):
            ch = body[i]
            if ch == "\\" and i + 1 < len(body):
                nxt = body[i + 1]
                mapping = {"n": "\n", "t": "\t", '"': '"', "\\": "\\", "r": "\r", "0": "\x00"}
                out.append(mapping.get(nxt, nxt))
                i += 2
                continue
            out.append(ch)
            i += 1
        return "".join(out)
    return v


def _coerce_scalar(v: str) -> Any:
    v = v.strip()
    if v == "":
        return ""
    if v in ("null", "~", "Null", "NULL"):
        return None
    if v in ("true", "True", "TRUE"):
        return True
    if v in ("false", "False", "FALSE"):
        return False
    if v == "[]":
        return []
    if v == "{}":
        return {}
    # Inline flow sequence: [a, b, c]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_coerce_scalar(x) for x in _split_flow(inner)]
    # int / float
    if re.fullmatch(r"-?\d+", v):
        try:
            return int(v)
        except ValueError:
            pass
    if re.fullmatch(r"-?\d+\.\d+", v):
        try:
            return float(v)
        except ValueError:
            pass
    return _strip_quotes(v)


def _split_flow(s: str) -> list[str]:
    out: list[str] = []
    depth = 0
    cur = []
    in_q: str | None = None
    for ch in s:
        if in_q:
            cur.append(ch)
            if ch == in_q:
                in_q = None
            continue
        if ch in ("'", '"'):
            in_q = ch
            cur.append(ch)
            continue
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur).strip())
    return out


def _indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


_BLOCK_SCALAR_MARKER = re.compile(
    r"^(?P<prefix>.*?:\s*)"
    r"(?P<style>[|>])(?P<chomp>[+\-]?)\s*$"
)


def _fold_block_scalars(text: str) -> str:
    """Rewrite block-scalar values `key: |` / `key: >` to single-line, double-
    quoted strings that the rest of the parser already understands.

    Respects chomping modifier '-' (strip trailing newline) vs default (keep).
    Folded style '>' joins lines with a single space.
    """
    raw_lines = text.splitlines()
    i = 0
    out: list[str] = []
    while i < len(raw_lines):
        line = raw_lines[i]
        m = _BLOCK_SCALAR_MARKER.match(line)
        if not m:
            out.append(line)
            i += 1
            continue
        prefix = m.group("prefix")
        style = m.group("style")
        chomp = m.group("chomp")
        key_indent = len(line) - len(line.lstrip(" "))
        # Collect following lines that are deeper-indented than the key line.
        j = i + 1
        block_lines: list[str] = []
        block_indent: int | None = None
        while j < len(raw_lines):
            nxt = raw_lines[j]
            if nxt.strip() == "":
                # Blank line belongs to the block only if followed by a deeper line.
                block_lines.append("")
                j += 1
                continue
            ind = len(nxt) - len(nxt.lstrip(" "))
            if ind <= key_indent:
                break
            if block_indent is None:
                block_indent = ind
            block_lines.append(nxt[block_indent:] if ind >= block_indent else nxt.strip())
            j += 1
        # Remove trailing blank lines from the block unless chomp == '+'
        while block_lines and block_lines[-1] == "":
            block_lines.pop()
        if style == "|":
            joined = "\n".join(block_lines)
        else:  # ">"
            joined = " ".join(line_.strip() for line_ in block_lines if line_.strip())
        if chomp != "-":
            # Default keep: literal blocks get a single trailing newline.
            joined = joined + ("\n" if style == "|" else "")
        # Produce a double-quoted YAML scalar. Escape \ and ".
        escaped = joined.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        out.append(f'{prefix}"{escaped}"')
        i = j
    return "\n".join(out)


def _preprocess(text: str) -> list[tuple[int, str]]:
    """Return (indent, content) for each non-blank, non-comment line."""
    text = _fold_block_scalars(text)
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        # Strip trailing-only '#' comments but NOT '#' inside quoted strings.
        stripped = raw.rstrip()
        if not stripped.strip():
            continue
        # naive comment removal: drop '#...' not inside quotes
        in_q: str | None = None
        out_chars: list[str] = []
        i = 0
        while i < len(stripped):
            ch = stripped[i]
            if in_q:
                out_chars.append(ch)
                # Respect \" escapes inside double-quoted strings.
                if in_q == '"' and ch == "\\" and i + 1 < len(stripped):
                    out_chars.append(stripped[i + 1])
                    i += 2
                    continue
                if ch == in_q:
                    in_q = None
                i += 1
                continue
            if ch in ("'", '"'):
                in_q = ch
                out_chars.append(ch)
                i += 1
                continue
            if ch == "#":
                break
            out_chars.append(ch)
            i += 1
        content = "".join(out_chars).rstrip()
        if not content.strip():
            continue
        lines.append((_indent_of(content), content))
    return lines


def _parse_block(lines: list[tuple[int, str]], idx: int, base_indent: int) -> tuple[Any, int]:
    """Parse a block starting at lines[idx] whose indent is >= base_indent."""
    if idx >= len(lines):
        return None, idx

    first_indent, first_content = lines[idx]
    if first_indent < base_indent:
        return None, idx

    # Sequence?
    if first_content.lstrip().startswith("- "):
        seq: list[Any] = []
        while idx < len(lines):
            indent, content = lines[idx]
            if indent < base_indent:
                break
            if indent != base_indent:
                break
            stripped = content.lstrip()
            if not stripped.startswith("- "):
                break
            item_text = stripped[2:]
            # "- key: value" inline mapping? Treat as mapping with one key,
            # possibly followed by deeper-indented keys.
            m = re.match(r"^([A-Za-z0-9_\-]+)\s*:\s*(.*)$", item_text)
            if m and not item_text.startswith("- "):
                key, rest = m.group(1), m.group(2).strip()
                item_map: dict[str, Any] = {}
                if rest:
                    item_map[key] = _coerce_scalar(rest)
                else:
                    idx += 1
                    val, idx = _parse_block(lines, idx, base_indent + 2)
                    item_map[key] = val if val is not None else None
                    # consume siblings belonging to this item (indent > base_indent)
                    # Not applicable here since we already parsed the full sub-block.
                    seq.append(item_map)
                    continue
                # consume any following lines that are siblings of this item
                idx += 1
                while idx < len(lines):
                    nind, ncontent = lines[idx]
                    if nind <= base_indent:
                        break
                    # attach as additional keys in item_map
                    m2 = re.match(r"^([A-Za-z0-9_\-]+)\s*:\s*(.*)$", ncontent.lstrip())
                    if not m2:
                        break
                    k2, v2 = m2.group(1), m2.group(2).strip()
                    if v2:
                        item_map[k2] = _coerce_scalar(v2)
                    else:
                        idx += 1
                        sub, idx = _parse_block(lines, idx, nind + 2)
                        item_map[k2] = sub
                        continue
                    idx += 1
                seq.append(item_map)
                continue
            # "- scalar"
            seq.append(_coerce_scalar(item_text))
            idx += 1
        return seq, idx

    # Mapping
    mapping: dict[str, Any] = {}
    while idx < len(lines):
        indent, content = lines[idx]
        if indent < base_indent:
            break
        if indent != base_indent:
            # Unexpected deeper block without a parent; stop.
            break
        m = re.match(r"^([A-Za-z0-9_\-\.]+)\s*:\s*(.*)$", content.lstrip())
        if not m:
            break
        key, rest = m.group(1), m.group(2).strip()
        if rest:
            mapping[key] = _coerce_scalar(rest)
            idx += 1
        else:
            idx += 1
            val, idx = _parse_block(lines, idx, base_indent + 2)
            mapping[key] = val if val is not None else {}
    return mapping, idx


def load(text: str) -> Any:
    lines = _preprocess(text)
    if not lines:
        return {}
    base = lines[0][0]
    val, _ = _parse_block(lines, 0, base)
    return val


def load_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return load(fh.read())


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(load_file(sys.argv[1]), indent=2, default=str))
