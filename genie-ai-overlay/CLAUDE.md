# CLAUDE.md — genie-ai-overlay

## Python Environment

Always use a **virtual environment** for any pip/Python operations:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"
```

Never use `--break-system-packages`.

## Testing

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

## Linting & Formatting

```bash
source .venv/bin/activate
ruff check tests/
ruff format --check tests/
```
