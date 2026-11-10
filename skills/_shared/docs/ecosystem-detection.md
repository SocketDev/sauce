List the manifest and lock files in the project root. The command prints only the files that exist:

```shell
ls -d package.json package-lock.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb requirements.txt pyproject.toml setup.py setup.cfg Pipfile Cargo.toml Gemfile pom.xml packages.config go.mod 2>/dev/null || true
```

Match the results against this table:

| Ecosystem | Manifest Files                                                           |
| --------- | ------------------------------------------------------------------------ |
| npm       | `package.json` + `package-lock.json`                                     |
| pnpm      | `package.json` + `pnpm-lock.yaml`                                        |
| yarn      | `package.json` + `yarn.lock`                                             |
| bun       | `package.json` + `bun.lock` or `bun.lockb`                               |
| PyPI      | `requirements.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile` |
| Cargo     | `Cargo.toml`                                                             |
| Bundler   | `Gemfile`                                                                |
| Maven     | `pom.xml`                                                                |
| NuGet     | `*.csproj`, `packages.config`                                            |
| Go        | `go.mod`                                                                 |

For npm, pnpm, yarn, and bun, the lock file tells them apart. If `package.json` has no lock file, ask the user which package manager the project uses. If several ecosystems are present, handle each one separately. In a monorepo, also check the workspace folders, because manifests can sit below the root.
