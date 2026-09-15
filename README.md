# diffwalk

diffwalk turns AI-generated Git changes into ordered browser walkthroughs, with every
explanation attached to its exact diff.

## Installation

Requires Git and Node.js 22 or 24. Install the CLI:

```bash
npm install --global diffwalk
```

Install the skill to teach a compatible coding agent how to capture, explain, and
validate changes:

```bash
npx skills add minipai/diffwalk --skill diffwalk
```

Add `-g` to install the skill globally. The skill is separate from the CLI;
start a new agent session after installing it. From a local checkout, use
`npx skills add ./skills/diffwalk --skill diffwalk`.

## Quick start

In your project's Git working tree, ask your agent:

> Use diffwalk to capture my current changes, explain them in reading order, and
> validate the walkthrough.

Then preview the review in a browser with JavaScript enabled:

```bash
diffwalk view
```

Press Ctrl+C to stop the local preview. Export an offline HTML file or publish a
shareable link:

```bash
diffwalk export html
diffwalk publish
```

Published links are unlisted: anyone with the link can read the review. Check
captured code and explanations for sensitive data before sharing. Only open
reviews authored by you or a trusted agent; authored HTML is not sanitized.

Add the local workspace to your project's `.gitignore`; it contains full captured
file contents and publication tokens:

```gitignore
.diffwalk/
```

## Documentation

## Documentation

- [Usage](https://github.com/minipai/diffwalk/blob/main/docs/usage.md): manual authoring, commands, YAML format, and review service settings.
- [Agent skill](skills/diffwalk/SKILL.md): the workflow your agent follows.
- [Development](https://github.com/minipai/diffwalk/blob/main/docs/development.md): local development, testing, and self-hosting.
