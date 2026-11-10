| Ecosystem | Removal Command                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| npm       | `npm uninstall {package}`                                                                                                       |
| pnpm      | `pnpm remove {package}`                                                                                                         |
| yarn      | `yarn remove {package}`                                                                                                         |
| PyPI      | Edit `requirements.txt` / `pyproject.toml` directly to remove the line, then `pip install -r requirements.txt` or `poetry lock` |
| Cargo     | `cargo remove {package}`                                                                                                        |
| Bundler   | Edit `Gemfile` to remove the entry, then `bundle install`                                                                       |
| Maven     | Edit `pom.xml` to remove the `<dependency>` block, then `mvn dependency:resolve`                                                |
| NuGet     | `dotnet remove package {package}`                                                                                               |
| Go        | Edit `go.mod` to remove the entry, then `go mod tidy`                                                                           |
