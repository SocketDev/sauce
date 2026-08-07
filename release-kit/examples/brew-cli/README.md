# brew-cli example

A CLI published to npm plus a Homebrew tap: channels `npm`, `github-release`,
`brew`. The tap layout is modeled by `tap-fixture/` (an unsharded
`Formula/examplecli.rb` - the same shape `SocketDev/homebrew-socket`
carries), and `release-fixture/checksums.txt` shows BOTH checksum grammars
the brew tooling accepts: the kit release tail's `sha256: <hex>  <name>`
lines and plain `<hex>  <name>` shasum lines. The formula sha256s always
come from this manifest - brew-publish never re-hashes an asset.

Tap consumers run once:

```
export HOMEBREW_REQUIRE_TAP_TRUST=1
brew trust SocketDev/socket
```
