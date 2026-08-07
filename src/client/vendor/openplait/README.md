# Vendored OpenPlait alpha packages

These package tarballs make the OpenLIT integration branch self-contained
until `@openplait/*` is published to a package registry. They are standard
`npm pack` artifacts built from the sibling OpenPlait workspace at version
`0.1.0-alpha.0`.

OpenLIT consumes the packages through `file:` dependencies in `package.json`.
Replace those references with registry versions when the packages are
published; application imports do not need to change.

To refresh the artifacts after changing OpenPlait, run `npm pack` for
`@openplait/core`, `@openplait/adapter-sdk`,
`@openplait/adapter-clickhouse`, `@openplait/adapter-tempo`,
`@openplait/adapter-loki`, `@openplait/adapter-prometheus`,
`@openplait/adapter-jaeger`, and `@openplait/runtime`, then update the package
lock.
