export const commandNames = [
  'inspect',
  'changes',
  'change',
  'file',
  'check',
  'view',
  'export',
  'publish',
  'unpublish',
  'help',
] as const

export type CommandName = (typeof commandNames)[number]

const walkDirectory = '.diffwalk/<walkId>'
const capturePath = `${walkDirectory}/capture.json`
const explanationsPath = `${walkDirectory}/explanations.yaml`

export function isCommandName(name: string): name is CommandName {
  return (commandNames as readonly string[]).includes(name)
}

export function topLevelHelp(): string {
  return `Diffwalk reads Git changes as an ordered sequence of explanations and their exact diffs.

Quick start:
  diffwalk inspect                    create a timestamped walk under .diffwalk/
  edit the current explanations.yaml  author ordered sections (the only file you edit)
  diffwalk check                      validate capture + explanations
  diffwalk view                       preview the review in a local browser
  diffwalk export html                write a self-contained HTML review
  diffwalk publish                    publish a hosted review and print its link

Commands:
  inspect    capture working-tree changes or committed revisions into a timestamped walk
  changes    list captured change blocks (--json for structured output)
  change     read one captured change block by ID
  file       read one captured file side (--before or --after)
  check      validate capture + explanations and report counts
  view       preview the review in a local browser without writing a file
  export     write an HTML review or portable ExplainDocument JSON
  publish    publish the review to the hosted service and print its unlisted link
  unpublish  remove a published review with its revocation token
  help       show help for a command

File ownership:
  ${capturePath}       machine-owned; never edit by hand
  ${explanationsPath}  author-edited; the only file you should change

Defaults:
  current walk    ID stored in .diffwalk/current
  authoring       ${walkDirectory}/
  HTML export     ${walkDirectory}/diffwalk.html
  JSON export     ${walkDirectory}/diffwalk.json

Next steps:
  After authoring, run \`diffwalk check\`, then \`diffwalk view\` or \`diffwalk export html\`.
  Share a link instead of a file with \`diffwalk publish\`.
  Run \`diffwalk help <command>\` for command-specific options.
  Use \`diffwalk changes --json\` and \`diffwalk change <id>\` to inspect what was captured.
`
}

export function commandHelp(name: CommandName): string {
  switch (name) {
    case 'inspect':
      return `diffwalk inspect — capture working-tree changes or committed revisions

Captures staged, unstaged, renamed, deleted, and untracked UTF-8 files relative to
--base and creates ${walkDirectory}/ with machine-owned capture.json and an
explanations.yaml skeleton to author. The walk ID combines the capture time in ISO 8601
basic format with the first eight characters of captureId. .diffwalk/current selects
the default walk for every later command. Re-running inspect with unchanged contents
reuses that walk and never overwrites its explanations; changed contents create a new
walk while the earlier one remains available.

Usage:
  diffwalk inspect [<commit> | --from <revision> --to <revision>] [options]
  diffwalk inspect [--base HEAD] [options]

Options:
  --base <revision>        Git base to diff against (default HEAD)
  --from <revision>        committed revision range start (requires --to)
  --to <revision>          committed revision range end (requires --from)
  --output <path>          write capture to an explicit path instead of creating a walk
  --explanations <path>    write or preserve authoring YAML at an explicit path
  -h, --help               show this help

File ownership:
  capture.json is machine-owned. explanations.yaml is the only file you edit.

Authoring shape:
  captureId: <from capture.json>
  title: <names the whole change set; becomes the review heading>
  summary: |
    Optional opening. Markdown, and inline HTML is allowed.
  sections:
    - title: <one idea>
      steps:
        - text: |
            Markdown. Inline HTML is allowed, so an <svg> diagram can sit here.
          changes: [change-001]

  A step needs text, changes, or both, so prose and diffs interleave in the order you
  write them. Embed images as data: URIs or inline <svg>: an external image URL is
  blocked on the hosted review even though it loads in the local HTML file.

Next steps:
  Edit the printed explanations path, then run \`diffwalk check\`. Inspect current
  capture IDs with \`diffwalk changes\`.

Committed changes:
  diffwalk inspect <commit> captures that commit against its first parent.
  diffwalk inspect --from <revision> --to <revision> compares two committed revisions
  directly from Git objects and ignores the working tree. Root commits cannot use the
  single-commit form because they have no first parent.
`
    case 'changes':
      return `diffwalk changes — list captured change blocks

Reads the current walk's capture.json and prints a concise summary of every captured
change. With --json it prints structured data (IDs, paths, coordinates, before, and
after) that an agent can consume; it never prints full captured file contents.

Usage:
  diffwalk changes [--json] [--input <capture-path>]

Options:
  --json                 print structured JSON change data
  --input <path>         explicit capture path (default current walk)
  -h, --help             show this help

Next steps:
  Read one block with \`diffwalk change <id>\` or a file side with \`diffwalk file <path> --before\`.
`
    case 'change':
      return `diffwalk change — read one captured change block

Prints the path, line coordinates, and before/after contents of one captured change
block. Unknown IDs are rejected with a nonzero exit.

Usage:
  diffwalk change <id> [--input <capture-path>]

Options:
  --input <path>         explicit capture path (default current walk)
  -h, --help             show this help

Next steps:
  List IDs with \`diffwalk changes\` or read a whole file side with \`diffwalk file <path> --after\`.
`
    case 'file':
      return `diffwalk file — read one captured file side

Prints the exact captured old or new side of one file. Choose exactly one side with
--before or --after. Unknown paths and invalid side selections are rejected.

Usage:
  diffwalk file <path> (--before | --after) [--input <capture-path>]

Options:
  --before               print the captured old side
  --after                print the captured new side
  --input <path>         explicit capture path (default current walk)
  -h, --help             show this help

Next steps:
  Read individual change blocks with \`diffwalk change <id>\`.
`
    case 'check':
      return `diffwalk check — validate capture and explanations

Reads the current walk's capture.json and explanations.yaml and validates the pairing: the
explanations must target the capture's captureId, every referenced change ID must be
known, nothing may be left unexplained, and every selected block must materialize to an
exact patch. Showing a change in more than one step is allowed and reported, not
rejected. On success it reports section, step, change, and file counts.

Usage:
  diffwalk check [--input <capture-path>] [--explanations <yaml-path>]

Options:
  --input <path>         explicit capture path (default current walk)
  --explanations <path>  explicit explanations path (default current walk)
  -h, --help             show this help

Next steps:
  When check passes, read with \`diffwalk view\`, export with \`diffwalk export html\`,
  or publish with \`diffwalk publish\`. A stale captureId means the input files belong
  to different walks or changed after authoring; use a matching pair.
`
    case 'view':
      return `diffwalk view — preview the review in a local browser

Validates the current walk, materializes the exact patches in memory, starts a temporary
loopback-only server, and opens the review in the default browser. No HTML file is
written. Press Ctrl+C to stop the local server.

Usage:
  diffwalk view [--input <capture-path>] [--explanations <yaml-path>]

Options:
  --input <path>         explicit capture path (default current walk)
  --explanations <path>  explicit explanations path (default current walk)
  -h, --help             show this help

Next steps:
  Save the same review with \`diffwalk export html\`, or share a link with \`diffwalk publish\`.
`
    case 'export':
      return `diffwalk export — write an HTML review or ExplainDocument JSON

Validates the current walk, materializes the exact patches, then writes the requested
artifact. HTML is one portable offline review with its styles and diff runtime embedded.
JSON is the version 1 ExplainDocument snapshot for integrations and archives.

Usage:
  diffwalk export <html|json> [--input <capture-path>] [--explanations <yaml-path>] [--output <path>]

Options:
  --input <path>         explicit capture path (default current walk)
  --explanations <path>  explicit explanations path (default current walk)
  --output <path>        explicit output path (default diffwalk.html or diffwalk.json
                         in the walk)
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`. The exported document remains format version 1.
`
    case 'publish':
      return `diffwalk publish — publish a hosted review and print its link

Validates the current walk, materializes the exact patches, and uploads the version 1
ExplainDocument to the review service. The service stores the document and renders it
with its own shared renderer, so no HTML file is uploaded or stored. Publication is
unlisted: anyone holding the link can read it.

Reviews are immutable. Publishing again creates a separate review and a separate link.
No account or publish credential is required.

Usage:
  diffwalk publish [--input <capture-path>] [--explanations <yaml-path>] [--service https://review.diffwalk.dev]

Options:
  --input <path>         explicit capture path (default current walk)
  --explanations <path>  explicit explanations path (default current walk)
  --service <url>        review service origin (default $DIFFWALK_SERVICE_URL, else the hosted service)
  -h, --help             show this help

Next steps:
  Validate first with \`diffwalk check\`. Keep the printed revocation token: it is the
  only way to run \`diffwalk unpublish\` later. For an offline copy use \`diffwalk export html\`.
`
    case 'unpublish':
      return `diffwalk unpublish — remove a published review

Deletes one published review from the review service. The revocation token printed when
the review was published is required, and it revokes only that review.

Usage:
  diffwalk unpublish <review-id> --token <revocation-token> [--service https://review.diffwalk.dev]

Options:
  --token <token>        the revocation token printed at publish time (required)
  --service <url>        review service origin (default $DIFFWALK_SERVICE_URL, else the hosted service)
  -h, --help             show this help

Next steps:
  A removed review's link stops working. Publish a revision with \`diffwalk publish\`.
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
