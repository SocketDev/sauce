# Ecosystem Detection

How to detect which package ecosystems are present in a project.

## Detection

List the manifest and lock files that exist in the project root — the command prints only the ones that are present:

```shell
ls -d package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb requirements.txt pyproject.toml setup.py setup.cfg Pipfile Cargo.toml Gemfile pom.xml packages.config go.mod 2>/dev/null || true
```

Match the results against this table:

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
