# Comment style

The convention every source file in this repo follows, so doc comments can be
harvested into one docs site across all of ADK DEV's projects.

## Format

TypeScript and JavaScript use **TSDoc** (`/** */`). Other languages in the wider
project set use their own native format (Google-style docstrings for Python,
KDoc for Kotlin, PHPDoc for PHP, Doxygen for C/C++), so one generator per
language can read them all.

```ts
/**
 * One line saying what this does and why it exists.
 *
 * @param tzOffsetMin Minutes east of UTC, as the client reports it.
 * @returns The calendar date that instant falls on for that user.
 * @module reporting
 * @public
 */
```

## Rules

- **Document the public surface.** Every exported function, hook, component,
  context, type and route handler gets a doc comment. Unexported one-line
  helpers do not.
- **Short.** A summary line, then `@param` / `@returns` / `@throws` only where
  they say something the signature does not. Aim for under six lines.
- **What and why, never how.** If the body already says it, do not restate it.
- **Do not restate the parameter name.** `@param userId The user id` is noise.
  Say where the value comes from or what it must satisfy.
- **Inline comments earn their place.** Keep one only for a non-obvious
  constraint: a workaround, an ordering requirement, the origin of a magic
  number, a known upstream bug. Delete anything that narrates a statement.
- **No changelog comments.** Nothing that says what a line used to be. That
  belongs in git, in `DEVDOC.md` if it is a project-wide decision, or in
  `not_for_you.md` if it is a local one.
- **No em dashes.** Use a hyphen.

## Cross-repo tags

Used consistently so the aggregated docs site can group and filter:

| Tag | Meaning |
|---|---|
| `@module <area>` | The feature area, matching a README feature heading (`auth`, `transactions`, `credit-cards`, `reporting`, `theming`). |
| `@public` | Part of the project's own external surface: an API route, an exported library function, a CLI command. Omit for internal code. |
| `@since <version>` | Only where a real version exists. Never invent one. |

## What is not documented here

`src/components/ui/**` is vendored shadcn/ui. It is left as upstream ships it so
it can be regenerated; do not add doc comments there.
