from pathlib import Path

PROJECT_ROOT = Path(".")

PYTHON_HEADER = """# This file is part of Amina Care.
#
# Amina Care is free software: you can redistribute it and/or modify
# it under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# Amina Care is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Amina Care. If not, see <https://www.gnu.org/licenses/>.
"""

DART_HEADER = """// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.
"""

EXCLUDED_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    "node_modules",
    "dist",
    "build",
    ".dart_tool",
}


def should_skip(path: Path) -> bool:
    return any(part in EXCLUDED_DIRS for part in path.parts)


def has_license_header(content: str) -> bool:
    first_lines = "\n".join(content.splitlines()[:30])
    return "This file is part of Amina Care." in first_lines


def insert_python_header(content: str) -> str:
    lines = content.splitlines(keepends=True)
    insert_index = 0

    if lines and lines[0].startswith("#!"):
        insert_index = 1

    if len(lines) > insert_index and "coding" in lines[insert_index]:
        insert_index += 1

    return (
        "".join(lines[:insert_index])
        + PYTHON_HEADER.strip()
        + "\n\n"
        + "".join(lines[insert_index:])
    )


def insert_dart_header(content: str) -> str:
    return DART_HEADER.strip() + "\n\n" + content


def update_file(path: Path) -> bool:
    content = path.read_text(encoding="utf-8")

    if has_license_header(content):
        return False

    if path.suffix == ".py":
        updated_content = insert_python_header(content)
    elif path.suffix == ".dart":
        updated_content = insert_dart_header(content)
    else:
        return False

    path.write_text(updated_content, encoding="utf-8")
    return True


def main():
    updated_files = []

    for path in PROJECT_ROOT.rglob("*"):
        if should_skip(path):
            continue

        if path.suffix not in {".py", ".dart"}:
            continue

        if update_file(path):
            updated_files.append(path)

    print(f"Updated {len(updated_files)} files.")

    for path in updated_files:
        print(f"- {path}")


if __name__ == "__main__":
    main()