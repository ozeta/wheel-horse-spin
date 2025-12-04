# Contributing to Wheel Horse Spin

## Philosophy

Keep the project framework-free, lightweight, and easily readable. Favor small, surgical changes over large refactors. Preserve existing procedural patterns; avoid introducing build tooling, bundlers, or complex abstractions unless explicitly requested.

## Project Structure

- Single-player logic lives in `sketch.js` with UI in `single-player-game.html` and styles in `style.css`.
- Multiplayer server & docs are in `multiplayer-race/` (WebSocket + REST + optional Postgres persistence).
- Shared multiplayer client canvas logic in `mp-game.js`.
- OpenAPI spec at `multiplayer-race/openapi.yaml` with HTML viewer `multiplayer-race/api-docs.html`.

## Coding Guidelines

- Use descriptive variable names (avoid single letters except for tight loops).
- Keep functions small; separate data preparation from rendering.
- Do not convert procedural code into classes unless a clear, requested benefit.
- Group new constants near existing constant blocks (`sketch.js` or `server.js`).
- Avoid adding dependencies unless required for a new feature (discuss first).
- When adjusting race logic, respect deceleration completion criteria before declaring a race finished.

## Pre-commit Hooks

This repository uses [pre-commit](https://pre-commit.com/) to automatically run checks before commits.

### Setup

```bash
# Install pre-commit (requires Python)
pip install pre-commit

# Install the git hooks
pre-commit install
```

### What Gets Checked

- **File formatting**: trailing whitespace, end-of-file fixes, line endings
- **YAML**: syntax validation
- **JSON**: syntax validation (excluding package-lock.json)
- **JavaScript**: basic syntax validation with JSHint
- **Markdown**: linting with markdownlint
- **Large files**: prevents accidentally committing files over 1MB
- **Conflicts**: checks for merge conflict markers
- **Branch protection**: prevents direct commits to main

### Running Manually

```bash
# Run all hooks on all files
pre-commit run --all-files

# Run hooks on staged files only
pre-commit run
```

### Configuration Files

- `.pre-commit-config.yaml`: hook configuration
- `.jshintrc`: JavaScript linting rules
- `.markdownlint.json`: Markdown linting rules
- `.yamllint`: YAML linting rules

## Multiplayer Specifics

- Phases: `lobby` | `countdown` | `race` | `results`; ensure transitions broadcast updated `roomState`.
- Dynamic boost key rotation currently client-side: add server authority only after discussion.
- Bots fill lanes (`TOTAL_LANES - humanCount`) and use variability factors (`biasFactor`, `jitterScale`, `boostPreference`). Keep variation lightweight.
- WebSocket messages must remain compact; avoid sending full historical data each tick.

## Database

- Schema managed idempotently by `db/migrate.js` on startup if `DATABASE_URL` present.
- Race persistence uses `saveRaceResults`; extend by adding new columns then updating migration script.
- Index new columns if they participate in filters or sorts.

## Documentation

- Update relevant README sections when adding or modifying endpoints or mechanics.
- Extend `openapi.yaml` for any new REST routes; keep schema descriptions concise.
- Add brief usage examples for new WebSocket message types in multiplayer README.

## Commit Messages

Use concise imperative style:

```
feat: add dynamic boost key rotation
fix: correct deceleration completion check
docs: expand multiplayer README with transcript
refactor: extract geometry calculation into helper
```

Group related doc updates with code changes when they clarify the feature.

## PR Expectations

- Describe intent, implementation summary, and any trade-offs.
- List affected files.
- Include manual test steps (e.g., reproduction + verification).
- Note any follow-up tasks explicitly (e.g., "Need server-side validation in next PR").

## Testing / Verification

- Manual browser test: verify race start, boost behavior, finish overlay.
- For multiplayer: open multiple tabs, ensure countdown, dynamic key rotation, race end, and leaderboard endpoints respond.
- Seed script (`db/seed.js`) supplies demo data; re-run if adjusting schema.

## Performance Considerations

- Keep tick payload minimal; avoid per-frame heavy computations in `draw()` outside race state.
- Throttle expensive DOM updates; prefer batched rendering logic.

## Accessibility / UX (Future Enhancements)

- Potential fixed boost key mode for users sensitive to rotation.
- Optional reduced-motion setting (skip lane color alternation or flashing).

## Getting Help

Open a discussion or issue describing:

- Context (single-player or multiplayer)
- Desired change
- Constraints (performance, compatibility)
- Alternatives considered

## License

Currently no explicit license; treat as private/personal. Do not add third-party code without attribution and prior approval.
