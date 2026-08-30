export const commandNames = [
  'inspect',
  'changes',
  'change',
  'file',
  'check',
  'view',
  'report',
  'export',
  'publish',
  'unpublish',
  'help',
] as const

export type CommandName = (typeof commandNames)[number]

const defaults = {
  capture: '.explain/capture.json',
  explanations: '.explain/explanations.yaml',
  document: '.explain/document.json',
  report: '.explain/report.html',
}

export function isCommandName(name: string): name is CommandName {
  return (commandNames as readonly string[]).includes(name)
}

export function topLevelHelp(): string {
  return `Diffwalk reads Git working-tree changes as an ordered sequence of explanations and their exact diffs.

Quick start:
  diffwalk inspect                    capture changes into .explain/capture.json
  edit .explain/explanations.yaml     author ordered sections (the only file you edit)
  diffwalk check                      validate capture + explanations
  diffwalk view                       open the terminal reader
  diffwalk report                     write a self-contained HTML report
  diffwalk publish                    publish a hosted report and print its link

Commands:
  inspect    capture Git changes and write .explain/capture.json plus an explanations.yaml skeleton
  changes    list captured change blocks (--json for structured output)
  change     read one captured change block by ID
  file       read one captured file side (--before or --after)
  check      validate capture + explanations and report counts
  view       open the terminal reader
  report     write a self-contained HTML report
  export     write the portable ExplainDocument JSON for integrations
  publish    publish the report to the hosted service and print its unlisted link
  unpublish  remove a published report with its revocation token
  help       show help for a command

File ownership:
  .explain/capture.json        machine-owned; never edit by hand
  .explain/explanations.yaml   author-edited; the only file you should change

Defaults:
  capture.json    ${defaults.capture}
  explanations    ${defaults.explanations}
  exported doc    ${defaults.document}
  report          ${defaults.report}

Next steps:
  After authoring, run \`diffwalk check\`, then \`diffwalk view\` or \`diffwalk report\`.
  Share a link instead of a file with \`diffwalk publish\`.
  Run \`diffwalk help <command>\` for command-specific options.
  Use \`diffwalk changes --json\` and \`diffwalk change <id>\` to inspect what was captured.
`
}

export function commandHelp(name: CommandName): string {
  switch (name) {
    case 'inspect':
      return `diffwalk inspect — capture Git working-tree changes

Captures staged, unstaged, renamed, deleted, and untracked UTF-8 files relative to
--base and writes ${defaults.capture} (machine-owned). On first use it also writes a
small ${defaults.explanations} skeleton to author. An existing explanations.yaml is
never overwritten; re-running inspect after the working tree changed leaves your
authoring file intact and \`diffwalk check\` reports the stale captureId.

Usage:
  diffwalk inspect [--base HEAD] [--output .explain/capture.json] [--explanations .explain/explanations.yaml]

Options:
  --base <revision>        Git base to diff against (default HEAD)
  --output <path>          capture output path (default ${defaults.capture})
  --explanations <path>    explanations path (default ${defaults.explanations})
  -h, --help               show this help

File ownership:
  ${defaults.capture} is machine-owned. ${defaults.explanations} is the only file you edit.

Next steps:
  Edit ${defaults.explanations} to order sections and assign change IDs, then run
  \`diffwalk check\`. Inspect capture IDs with \`diffwalk changes\`.
`
    case 'changes':
      return `diffwalk changes — list captured change blocks

Reads ${defaults.capture} and prints a concise summary of every captured change.
With --json it prints structured data (IDs, paths, coordinates, before, and after)
that an agent can consume; it never prints full captured file contents.

Usage:
  diffwalk changes [--json] [--input .explain/capture.json]

Options:
  --json                 print structured JSON change data
  --input <path>         capture path (default ${defaults.capture})
  -h, --help             show this help

Next steps:
  Read one block with \`diffwalk change <id>\` or a file side with \`diffwalk file <path> --before\`.
`
    case 'change':
      return `diffwalk change — read one captured change block

Prints the path, line coordinates, and before/after contents of one captured change
block. Unknown IDs are rejected with a nonzero exit.

Usage:
  diffwalk change <id> [--input .explain/capture.json]

Options:
  --input <path>         capture path (default ${defaults.capture})
  -h, --help             show this help

Next steps:
  List IDs with \`diffwalk changes\` or read a whole file side with \`diffwalk file <path> --after\`.
`
    case 'file':
      return `diffwalk file — read one captured file side

Prints the exact captured old or new side of one file. Choose exactly one side with
--before or --after. Unknown paths and invalid side selections are rejected.

Usage:
  diffwalk file <path> (--before | --after) [--input .explain/capture.json]

Options:
  --before               print the captured old side
  --after                print the captured new side
  --input <path>         capture path (default ${defaults.capture})
  -h, --help             show this help

Next steps:
  Read individual change blocks with \`diffwalk change <id>\`.
`
    case 'check':
      return `diffwalk check — validate capture and explanations

Reads ${defaults.capture} and ${defaults.explanations} and validates the pairing: the
explanations must target the capture's captureId, every section must reference known
change IDs exactly once, nothing may be left unassigned, and every selected block must
materialize to an exact patch. On success it reports section, change, and file counts.

Usage:
  diffwalk check [--input .explain/capture.json] [--explanations .explain/explanations.yaml]

Options:
  --input <path>         capture path (default ${defaults.capture})
  --explanations <path>  explanations path (default ${defaults.explanations})
  -h, --help             show this help

Next steps:
  When check passes, read with \`diffwalk view\`, export with \`diffwalk export\`, or
  render with \`diffwalk report\`. A stale captureId means the working tree changed:
  update ${defaults.explanations} or re-run \`diffwalk inspect\` after deleting it.
`
    case 'view':
      return `diffwalk view — open the terminal reader

Validates ${defaults.capture} and ${defaults.explanations}, materializes the exact
patches in memory, and opens the interactive reader. The reader folds explanations and
file diffs and switches split/stack layout; exit with q or Escape.

Usage:
  diffwalk view [--input .explain/capture.json] [--explanations .explain/explanations.yaml]

Options:
  --input <path>         capture path (default ${defaults.capture})
  --explanations <path>  explanations path (default ${defaults.explanations})
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`, then render a shareable copy with \`diffwalk report\`.
`
    case 'report':
      return `diffwalk report — write a self-contained HTML report

Validates ${defaults.capture} and ${defaults.explanations}, materializes the exact
patches in memory, and writes one portable HTML file that embeds the document, the
Markdown renderer, and the diff runtime. The report opens offline in any browser.

Usage:
  diffwalk report [--input .explain/capture.json] [--explanations .explain/explanations.yaml] [--output .explain/report.html]

Options:
  --input <path>         capture path (default ${defaults.capture})
  --explanations <path>  explanations path (default ${defaults.explanations})
  --output <path>        report output path (default ${defaults.report})
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`. Archive a portable document with \`diffwalk export\`.
`
    case 'export':
      return `diffwalk export — write the portable ExplainDocument JSON

Validates ${defaults.capture} and ${defaults.explanations}, materializes the exact
patches, and writes the version 1 ExplainDocument JSON that integrations and archives
expect. This is a snapshot for external consumers; view and report read capture plus
explanations directly.

Usage:
  diffwalk export [--input .explain/capture.json] [--explanations .explain/explanations.yaml] [--output .explain/document.json]

Options:
  --input <path>         capture path (default ${defaults.capture})
  --explanations <path>  explanations path (default ${defaults.explanations})
  --output <path>        document output path (default ${defaults.document})
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`. The exported document remains format version 1.
`
    case 'publish':
      return `diffwalk publish — publish a hosted report and print its link

Validates ${defaults.capture} and ${defaults.explanations}, materializes the exact
patches, and uploads the version 1 ExplainDocument to the report service. The service
stores the document and renders it with its own shared renderer, so no HTML file is
uploaded or stored. Publication is unlisted: anyone holding the link can read it.

Reports are immutable. Publishing again creates a separate report and a separate link.
No account or publish credential is required.

Usage:
  diffwalk publish [--input .explain/capture.json] [--explanations .explain/explanations.yaml] [--service https://reports.diffwalk.dev]

Options:
  --input <path>         capture path (default ${defaults.capture})
  --explanations <path>  explanations path (default ${defaults.explanations})
  --service <url>        report service origin (default $DIFFWALK_SERVICE_URL, else the hosted service)
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`. Keep the printed revocation token: it is the
  only way to run \`diffwalk unpublish\` later. For an offline copy use \`diffwalk report\`.
`
    case 'unpublish':
      return `diffwalk unpublish — remove a published report

Deletes one published report from the report service. The revocation token printed when
the report was published is required, and it revokes only that report.

Usage:
  diffwalk unpublish <report-id> --token <revocation-token> [--service https://reports.diffwalk.dev]

Options:
  --token <token>        the revocation token printed at publish time (required)
  --service <url>        report service origin (default $DIFFWALK_SERVICE_URL, else the hosted service)
  -h, --help             show this help

Next steps:
  A removed report's link stops working. Publish a revision with \`diffwalk publish\`.
`
    case 'help':
      return `diffwalk help — show help

Run \`diffwalk help\` for the top-level help, or \`diffwalk help <command>\` for a
command's options, defaults, and next steps. Bare \`diffwalk\`, \`--help\`, and \`-h\`
also print help.

Commands: ${commandNames.join(', ')}
`
  }
}
