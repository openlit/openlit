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

Enterprise providers register through the same registry from the enterprise
repository. CE contains only neutral contracts and no enterprise provider
names or permission policy.

