# Lights On documentation

Start with [Getting started](getting-started.md) to install Lights On and choose
which operations it may perform. Keep your project's tests and branch protection
in place; the agent's review cannot replace them.

## Guides

| Task | Guide |
|---|---|
| Install or update Lights On | [Getting started](getting-started.md) |
| Configure providers, limits and permissions | [Configuration reference](configuration.md) |
| Run issue, dependency and toolchain maintenance | [Maintenance workflows](maintenance.md) |
| Understand credentials, workers and merge checks | [Architecture and security boundaries](architecture.md) |
| Prepare versions and publish packages | [Releases](releases.md) |
| Diagnose a run or stop automation | [Operations and troubleshooting](operations.md) |
| Run tests or prepare a worker image | [Local development](development.md) |
| Run with monitored, restricted local network access | [Protected local execution](local-container.md) |
| Read the proposed product direction | [Mission, vision, strategy, and roadmap](mission-vision-strategy-roadmap.md) |

Before enabling unattended merges, configure exact CI check names and their App
IDs. Prepare the worker's offline dependencies, then observe a proposal/review
cycle. GitHub may suppress follow-on events from bot-created PRs or labels.

## Terms

| Term | Meaning |
|---|---|
| Installed repository | The repository receiving Lights On's files and GitHub writes, identified by `GITHUB_REPOSITORY`. |
| Upstream repository | A read-only reference repository, such as a maintenance fork's parent. |
| Controller | Trusted runner code that calls providers, dispatches tools and validates results. |
| Candidate workspace | A temporary copy where the agent prepares changes. |
| Worker | A restricted Docker container for shell commands or dependency validation. |
| Publisher | Trusted code that submits approved files or results to GitHub or a registry. |
| Gate | A check that can block review, publication or merging. Prompt guidance alone is not a gate. |
| Required check context | An exact CI check name, such as `test (24)`. |

## Source

- [Project overview](../README.md)
- [Default configuration](../.github/lights-on.yml)
- [Threat model](../THREAT_MODEL.md)
- [Workflows](../.github/workflows/)
- [Controllers and workers](../.github/lights-on/runner/)

The guides identify unsupported settings and known limits. If a guide, the
threat model and the implementation disagree, resolve that mismatch before
relying on the stronger guarantee.
