# Connector framework

Connectors are the common integration boundary for OpenLIT. A connector type
belongs to a category (`datasource`, `notification`, `memory`, and so on), and
an instance is a project- or organisation-scoped configuration with secrets
stored in the vault.

Datasource adapters are registered automatically from the existing datasource
registry. New datasource contributors should implement the existing
`DataSourceAdapterFactory`, declare its descriptor and capabilities, and add
adapter tests. The generic connector registry exposes that type to shared
configuration and future consumers without adding vendor-specific UI logic.

Enterprise-only providers can register through the same neutral registry from
the enterprise repository. Availability and plan metadata are represented by
the shared contract; permission and entitlement policy remains outside CE.
