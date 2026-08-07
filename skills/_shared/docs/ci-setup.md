# CI/CD Detection and Integration

Common CI/CD detection and setup instructions shared across skills.

## Detecting the CI/CD System

List the CI config files that exist in the project root - the command prints only the ones that are present:

```shell
ls -d .github/workflows .gitlab-ci.yml bitbucket-pipelines.yml Jenkinsfile .circleci/config.yml .travis.yml azure-pipelines.yml 2>/dev/null || true
```

Map each result to its CI system:

| CI System           | Config File               |
| ------------------- | ------------------------- |
| GitHub Actions      | `.github/workflows/*.yml` |
| GitLab CI           | `.gitlab-ci.yml`          |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` |
| Jenkins             | `Jenkinsfile`             |
| CircleCI            | `.circleci/config.yml`    |
| Travis CI           | `.travis.yml`             |
| Azure Pipelines     | `azure-pipelines.yml`     |

## Detecting the SCM Provider

Run `git remote -v` and match:

- `github.com` → GitHub
- `gitlab.com` or self-hosted GitLab → GitLab
- `bitbucket.org` → Bitbucket
- Other / not a git repo → Generic

## Integration Patterns

### GitHub Actions

Use `SocketDev/action@v1` after `actions/checkout` and before install steps:

```yaml
- uses: SocketDev/action@v1
  with:
    mode: <mode> # firewall, firewall-free, or patch
```

### GitLab CI / Bitbucket Pipelines / Generic

Install the Socket CLI or tool, then run it in a `before_script` or dedicated step after dependency install.
