# Ecosystem Detection

How to detect which package ecosystems are present in a project.

## Automated Detection

Run the ecosystem detection helper:

```shell
pnpm dlx tsx scripts/repo/helpers/detect-ecosystems.ts [--dir <path>]
```

This outputs JSON listing all detected ecosystems and their manifest files.

## Manual Detection

Scan the project root for manifest and lock files:

| Ecosystem | Manifest Files                                                           |
| --------- | ------------------------------------------------------------------------ |
| npm       | `package.json` + `package-lock.json`                                     |
| pnpm      | `package.json` + `pnpm-lock.yaml`                                        |
| yarn      | `package.json` + `yarn.lock`                                             |
| PyPI      | `requirements.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile` |
| Cargo     | `Cargo.toml`                                                             |
| Bundler   | `Gemfile`                                                                |
| Maven     | `pom.xml`                                                                |
| NuGet     | `*.csproj`, `packages.config`                                            |
| Go        | `go.mod`                                                                 |

For npm, pnpm, and yarn: differentiate by which lock file is present. If multiple ecosystems exist, process each independently.
