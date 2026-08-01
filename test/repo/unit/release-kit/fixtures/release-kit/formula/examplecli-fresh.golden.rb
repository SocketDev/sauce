# Managed by socket-release-kit (scripts/socket-release/brew-publish.mts).
# Do not hand-edit: the next formula bump rewrites this file from the
# release's own checksums.txt.
class Examplecli < Formula
  desc "examplecli (Socket release)"
  homepage "https://github.com/SocketDev/example-cli"
  version "1.2.3"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-darwin-arm64.tar.gz"
      sha256 "1111111111111111111111111111111111111111111111111111111111111111"
    end
    on_intel do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-darwin-x64.tar.gz"
      sha256 "2222222222222222222222222222222222222222222222222222222222222222"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-linux-arm64.tar.gz"
      sha256 "3333333333333333333333333333333333333333333333333333333333333333"
    end
    on_intel do
      url "https://github.com/SocketDev/example-cli/releases/download/v1.2.3/examplecli-linux-x64.tar.gz"
      sha256 "4444444444444444444444444444444444444444444444444444444444444444"
    end
  end

  def install
    bin.install "examplecli"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/examplecli --version")
  end
end
