Search the **entire codebase** for every reference to the target package. Be thorough - check all of the following:

# Direct Import/Require Patterns

| Ecosystem     | Patterns to Search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm/pnpm/yarn | `require('pkg')`, `require("pkg")`, `import ... from 'pkg'`, `import ... from "pkg"`, `import 'pkg'`, `import "pkg"`, `import('pkg')`, `import("pkg")`. Also check for subpath imports like `pkg/sub`.                                                                                                                                                                                                                                                                                                                                                          |
| PyPI          | `import pkg`, `from pkg import ...`. **Note:** the package name on PyPI often differs from the import name (e.g. `Pillow` → `PIL`, `beautifulsoup4` → `bs4`, `python-dotenv` → `dotenv`, `scikit-learn` → `sklearn`, `PyYAML` → `yaml`). Check both the package name and common import aliases. **Tip:** run `pip show <package-name>` - the output includes a `Location` field and the actual top-level package names are the directories at that location matching the package. Alternatively, check `top_level.txt` in the package's `.dist-info` directory. |
| Cargo         | `use crate_name::`, `extern crate crate_name`, references in proc-macro attributes. **Note:** hyphens in crate names become underscores in Rust code (e.g. `serde-json` → `serde_json`).                                                                                                                                                                                                                                                                                                                                                                        |
| Bundler       | `require 'gem_name'`, `require "gem_name"`, autoload references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Maven         | `import groupId.artifactId.` or subpackage patterns in `.java` and `.kt` files. Match on the groupId prefix.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| NuGet         | `using Namespace;` and `using static Namespace.` in `.cs` files. Match on the package's root namespace.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Go            | Import paths in `.go` files matching the module path from `go.mod` `require` entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

# Indirect Usage Detection

Some dependencies are used indirectly and will not appear in import statements. Check all of the following for the target package:

- **`@types/*` packages** - corresponds to a base package (e.g. `@types/node` supports Node.js APIs); check if the base package is used
- **Babel/ESLint/Jest/Prettier plugins** - referenced by short name in config files (e.g. `eslint-plugin-react` is listed as `react` in `.eslintrc`); search config files for the short name
- **CLI tools in `scripts`** - packages that provide binaries referenced in `package.json` `scripts` (e.g. `rimraf`, `concurrently`, `cross-env`); check the `scripts` block
- **Peer dependencies** - required by other installed packages; check if any installed package lists it as a peer dependency
- **Build tools and bundler plugins** - `webpack`, `vite`, `rollup`, `esbuild`, `parcel`, `turbopack` and their plugins; check config files
- **PostCSS/Tailwind plugins** - referenced in `postcss.config.*` or `tailwind.config.*`
- **Python entry points and console scripts** - packages providing CLI commands configured in `pyproject.toml` or `setup.cfg`
- **Bundler groups** - gems in `:development` or `:test` groups may only be used in specific contexts
- **Cargo build dependencies** - crates in `[build-dependencies]` are used by `build.rs`
- **Maven plugins** - `<plugin>` entries in `pom.xml` are not imported in code

# Where to Search

Search beyond just source code:

- Source files (`.ts`, `.js`, `.py`, `.rs`, `.go`, `.java`, `.cs`, `.rb`, etc.)
- Configuration files (`.eslintrc`, `babel.config.*`, `jest.config.*`, `webpack.config.*`, `vite.config.*`, etc.)
- `package.json` `scripts` block
- CI/CD configs (`.github/workflows/`, `.gitlab-ci.yml`, etc.)
- Shell scripts (`*.sh`)
- Dockerfiles
- Documentation that references the package as a runtime dependency
