# Pre-commit Hooks

This repository uses [pre-commit](https://pre-commit.com/) to automatically validate code quality before commits.

## Quick Start

1. **Install pre-commit** (requires Python):

   ```bash
   pip install pre-commit
   ```

2. **Install the git hooks**:

   ```bash
   pre-commit install
   ```

3. **Make commits as usual** - hooks will run automatically:

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

## What's Checked

The pre-commit hooks perform the following checks:

### General File Quality

- **Trailing whitespace**: removes trailing whitespace from files
- **End of file**: ensures files end with a newline
- **Line endings**: normalizes to LF (Unix-style)
- **Large files**: prevents committing files over 1MB
- **Merge conflicts**: detects unresolved merge conflict markers
- **Case conflicts**: prevents case-sensitive filename issues

### Language-Specific Checks

- **YAML**: validates syntax in `.yaml` and `.yml` files
- **JSON**: validates syntax (excludes `package-lock.json`)
- **JavaScript**: basic syntax validation using JSHint
- **Markdown**: linting for consistent formatting

### Branch Protection

- Prevents direct commits to the `main` branch (use feature branches instead)

## Running Manually

```bash
# Run all hooks on all files (useful for initial setup)
pre-commit run --all-files

# Run hooks on staged files only
pre-commit run

# Run a specific hook
pre-commit run jshint --all-files
```

## Configuration

The hooks are configured in `.pre-commit-config.yaml`. Supporting configuration files:

- **`.jshintrc`**: JavaScript linting rules (lenient to preserve existing code style)
- **`.markdownlint.json`**: Markdown linting rules
- **`.yamllint`**: YAML linting rules

## Skipping Hooks (Emergency Only)

If you need to bypass hooks temporarily:

```bash
git commit --no-verify -m "emergency fix"
```

**Note**: This should only be used in exceptional circumstances. The CI pipeline may still reject your commit.

## Troubleshooting

### Hook fails but I can't see why

Run the specific hook manually to see detailed output:

```bash
pre-commit run <hook-name> --all-files
```

### Pre-commit is slow on first run

The first run downloads and caches dependencies for each hook. Subsequent runs are much faster.

### I want to update the hooks

```bash
pre-commit autoupdate
```

## Philosophy

These hooks are configured to be **non-intrusive** and respect the existing codebase style:

- JSHint is lenient and focuses on catching actual errors, not style preferences
- Markdown and YAML linting allow existing patterns
- Hooks that would require code changes to pass are excluded

The goal is to catch obvious mistakes (syntax errors, merge conflicts, large files) without forcing style changes on the existing codebase.
