# Managed by socket-release-kit (scripts/socket-release/brew-publish.mts).
# Do not hand-edit: the next formula bump rewrites this file from the
# release's own checksums.txt.
class Examplecli < Formula
  desc "examplecli (Socket release)"
  homepage "https://github.com/SocketDev/example-cli"
  version "1.2.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.2/examplecli-darwin-arm64.tar.gz"
      sha256 "9999999999999999999999999999999999999999999999999999999999999999"
    end
    on_intel do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.2/examplecli-darwin-x64.tar.gz"
      sha256 "9999999999999999999999999999999999999999999999999999999999999999"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.2/examplecli-linux-arm64.tar.gz"
      sha256 "9999999999999999999999999999999999999999999999999999999999999999"
    end
    on_intel do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.2/examplecli-linux-x64.tar.gz"
      sha256 "9999999999999999999999999999999999999999999999999999999999999999"
    end
  end

  def install
    bin.install "examplecli"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/examplecli --version")
  end
end
