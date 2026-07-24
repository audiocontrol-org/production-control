# Fixture: `minimal-podcast`

**This is a fixture. It is not real content, and none ever lives in this repository.**

Every file in this directory — `outline.md`, `script.md`,
`assets/narration/take-01.wav` — is synthetic placeholder text, written only to give
`pc status` something to report on. None of it is a story, a subject, or anyone's
authored work. Per the project constitution (Principle VII, Subject-Agnostic) and
MANIFESTO.md: **authored content never lives in `production-control`.** Each real
subject keeps its own content repository, which depends on this package the way a
site depends on a build tool — this directory exists to demonstrate the shape of that
dependency, not to hold an example of it.

## What is here

- `episode.yaml` — declares three authored inputs (`outline`, `spoken`, `narration`,
  with `narration follows spoken`) and two targets (`voiceover`, `podcast`), using the
  real, shared `profiles/editorial-audio.yaml` unmodified.
- `outline.md`, `script.md`, `assets/narration/take-01.wav` — the placeholder authored
  bytes those identities point at.

Nothing here has ever been built: there is no `.production/ledger.yaml` and no `dist/`.
That is deliberate — it is what makes `pc status` interesting to run against this
fixture: `voiceover` reports it was never built, `podcast` reports `blocked` on
`voiceover` (its input has no content yet, so staleness cannot even be asked), and
`narration` reports `needs-review` because nothing has ever confirmed it against
`spoken` (see `pc review`, contracts/cli.md).

## Running it

From the repository root, after `npm run build`:

```
$ node dist/cli/index.js status --episode examples/minimal-podcast
outline    present       Authored node "outline" resolves, and it follows nothing.
spoken     present       Authored node "spoken" resolves, and it follows nothing.
narration  needs-review  Authored node "narration" follows "spoken", and no review has
                          ever been recorded against it: nobody has confirmed
                          "narration" answers "spoken" as it now stands. A human
                          decides; nothing rebuilds "narration".
voiceover  missing       "voiceover" has no record in the ledger: it has never been
                          built.
podcast    blocked       Input "voiceover" of "podcast" is absent (it has never been
                          built, so it has no content yet), so whether "podcast" is
                          stale cannot be known — supply "voiceover".
$ echo $?
0
```

(Reflowed to fit here; the real command prints each cause on one line.)

This requires no craft tool installed and no network access (FR-010) — `pc status`
only reads what is declared and what is recorded. Building `voiceover` or `podcast`
would additionally require a real audio-tooling provider on `PATH`, which is exactly
what this fixture does *not* attempt to demonstrate; see
`tests/integration/build.test.ts` and `tests/fixtures/fake-provider` for how the test
suite exercises a real build against a stand-in tool instead.

## Why it exists

`specs/001-episode-production-contract/contracts/cli.md` and
`specs/001-episode-production-contract/contracts/provider.md` describe the surface;
this fixture is a runnable instance of it, kept out of the test suite so it can be
pointed to from documentation (see the root `README.md` § Usage) as a working example
rather than an assertion.
