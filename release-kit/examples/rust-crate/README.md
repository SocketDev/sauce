# rust-crate example

A minimal crate the release kit stands up on the `crates` + `github-release`
channels: the cargo staged model (dry-run default, `--direct` under the
`cargo-publish` environment via crates.io Trusted Publishing), and the
registry-liveness-gated GitHub release. The kit CLIs run on node, so the
example carries a scripts-host package.json alongside Cargo.toml.

Note: the manifest ships as `Cargo.example.toml` — rename it to `Cargo.toml`
in a real crate. The fixture name keeps sauce's own cargo gates from
adopting the example as a first-party crate.
