{
  description = "OpenLit - Open-source LLM Observability Platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Go packages
        opamp-server = pkgs.buildGoModule {
          pname = "openlit-opamp-server";
          version = "0.0.1";
          src = ./src/opamp-server;
          vendorHash = "sha256-7rQ0+jV8v/W16Lx9KRVLoEhOfrKtKRxdUXuYCpuoMRo=";
          doCheck = false;
          meta = {
            description = "OpenLit OpAMP Server";
            homepage = "https://github.com/openlit/openlit";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "opamp-server";
          };
        };

        openlit-controller = pkgs.buildGoModule {
          pname = "openlit-controller";
          version = "0.0.1";
          src = ./openlit-controller;
          vendorHash = "sha256-YohapHEkKf5q5+bl9AvqAQyNwGWE8CEe3losEZF5wXA=";
          doCheck = false;
          meta = {
            description = "OpenLit Controller";
            homepage = "https://github.com/openlit/openlit";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "openlit-controller";
          };
        };

        gpu-collector = pkgs.buildGoModule {
          pname = "openlit-gpu-collector";
          version = "0.0.1";
          src = ./opentelemetry-gpu-collector;
          vendorHash = "sha256-I1iyIw9Qoa1qS55IqvN/qssDYRBre2tIHo9DkfRX+AI=";
          doCheck = false;
          meta = {
            description = "OpenLit OpenTelemetry GPU Collector";
            homepage = "https://github.com/openlit/openlit";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "opentelemetry-gpu-collector";
          };
        };

        # Helper script for Docker-based workflow
        openlit-cli = pkgs.writeShellScriptBin "openlit" ''
          #!${pkgs.runtimeShell}
          set -euo pipefail

          usage() {
            echo "OpenLit - Open-source LLM Observability Platform"
            echo ""
            echo "Usage: openlit <command>"
            echo ""
            echo "Commands:"
            echo "  start       Start OpenLit services with docker-compose"
            echo "  stop        Stop OpenLit services"
            echo "  status      Show service status"
            echo "  build       Build all components"
            echo "  dev-client  Start Next.js client dev server"
            echo "  version     Show version information"
            echo "  help        Show this help message"
            echo ""
            echo "For full documentation, visit: https://github.com/openlit/openlit"
          }

          require_compose_file() {
            if [ ! -f docker-compose.yml ] && [ ! -f docker-compose.yaml ]; then
              echo "Error: docker-compose.yml not found in the current directory." >&2
              echo "       Run this command from the repository root where docker-compose.yml is located." >&2
              exit 1
            fi
          }

          case "''${1:-help}" in
            start)
              require_compose_file
              echo "Starting OpenLIT services..."
              "${pkgs.docker-compose}/bin/docker-compose" up -d
              ;;
            stop)
              require_compose_file
              echo "Stopping OpenLIT services..."
              "${pkgs.docker-compose}/bin/docker-compose" stop
              ;;
            status)
              require_compose_file
              "${pkgs.docker-compose}/bin/docker-compose" ps
              ;;
            build)
              echo "Building OpenLIT components..."
              echo "Note: Use 'nix build .#<package>' for individual components"
              echo "Available packages: opamp-server, openlit-controller, gpu-collector"
              ;;
            dev-client)
              echo "Starting client dev server..."

              if [ ! -d src/client ]; then
                echo "Error: src/client directory not found. Client dev server cannot be started." >&2
                exit 1
              fi

              if ! command -v npm >/dev/null 2>&1; then
                echo "Error: npm is not available. The 'dev-client' command is intended for the development shell." >&2
                echo "       Run 'nix develop' or 'devbox shell' first, or install npm manually." >&2
                exit 1
              fi

              cd src/client
              npm run dev
              ;;
            version)
              echo "OpenLit (nix flake development build)"
              ;;
            help|--help|-h)
              usage
              ;;
            *)
              echo "Unknown command: $1"
              usage
              exit 1
              ;;
          esac
        '';
      in
      {
        packages = {
          default = openlit-cli;
          opamp-server = opamp-server;
          controller = openlit-controller;
          gpu-collector = gpu-collector;
          openlit = openlit-cli;
        };

        apps = {
          default = {
            type = "app";
            program = "${openlit-cli}/bin/openlit";
          };
          opamp-server = {
            type = "app";
            program = "${opamp-server}/bin/opamp-server";
          };
          controller = {
            type = "app";
            program = "${openlit-controller}/bin/openlit-controller";
          };
          gpu-collector = {
            type = "app";
            program = "${gpu-collector}/bin/opentelemetry-gpu-collector";
          };
        };

        devShells.default = pkgs.mkShell {
          name = "openlit-devshell";

          buildInputs = with pkgs; [
            # Go toolchain
            go
            golangci-lint
            gopls

            # Node.js toolchain
            nodejs_20
            npm

            # Docker / container tools
            docker
            docker-compose

            # General development
            git
            jq
            curl
          ];

          shellHook = ''
            echo "OpenLit Development Shell"
            echo "========================="
            echo ""
            echo "Available commands:"
            echo "  go version              - Check Go version"
            echo "  node --version          - Check Node.js version"
            echo "  docker --version        - Check Docker version"
            echo ""
            echo "Project structure:"
            echo "  src/opamp-server/       - Go OpAMP server"
            echo "  src/client/             - Next.js client"
            echo "  openlit-controller/     - Go controller"
            echo "  opentelemetry-gpu-collector/ - Go GPU collector"
            echo "  sdk/go/                 - Go SDK"
            echo ""
            echo "Quick start:"
            echo "  docker-compose up -d    - Start all services"
            echo "  cd src/client && npm run dev - Start client dev server"
            echo ""
            echo "Nix flake outputs:"
            echo "  nix run .               - Run OpenLit helper"
            echo "  nix build .#opamp-server - Build OpAMP server"
            echo "  nix develop             - Enter this dev shell"
            echo ""
          '';
        };

        overlays.default = final: prev: {
          openlit = openlit-cli;
          openlit-opamp-server = opamp-server;
          openlit-controller = openlit-controller;
          openlit-gpu-collector = gpu-collector;
        };

        checks = {
          opamp-server = opamp-server;
          controller = openlit-controller;
          gpu-collector = gpu-collector;
        };
      }
    );
}
