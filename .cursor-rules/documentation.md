# OpenLIT Documentation Cursor Rules

## Overview
These rules guide the creation and maintenance of documentation for OpenLIT, an open-source AI observability platform. Follow these standards to ensure consistency, clarity, and user-friendliness across all documentation.

## Documentation Structure

### File Organization
- Use `.mdx` format for all documentation files
- Organize files in logical hierarchies under `/docs/latest/`
- Main sections: `openlit/`, `sdk/`, `operator/`
- Use descriptive, kebab-case filenames (e.g., `quickstart-ai-observability.mdx`)
- Place reusable content in `/docs/snippets/` for import across multiple files

### Navigation Structure
- Update `docs.json` when adding new pages
- Organize content in logical groups with clear hierarchies
- Use descriptive titles and appropriate icons
- Maintain consistent navigation patterns across sections

## Content Standards

### Front Matter
Every documentation file must start with YAML front matter:
```yaml
---
title: "Clear, Descriptive Title"
sidebarTitle: "Short Title" # Optional, for sidebar display
description: "Brief description of the content (1-2 sentences)"
---
```

### Writing Style
- **Tone**: Professional, helpful, and accessible
- **Voice**: Active voice preferred, direct and clear
- **Audience**: Developers and technical users with varying experience levels
- **Language**: Use simple, clear language; avoid unnecessary jargon
- **Structure**: Start with overview, then step-by-step instructions

### Content Organization
1. **Introduction**: Brief overview of what the page covers
2. **Prerequisites**: List any requirements (if applicable)
3. **Main Content**: Step-by-step instructions or detailed explanations
4. **Examples**: Practical code examples and use cases
5. **Next Steps**: Links to related content or logical next actions

## Formatting Guidelines

### Headers
- Use descriptive, action-oriented headers
- Follow logical hierarchy (H1 → H2 → H3)
- Use sentence case for headers
- Examples: "Get started", "Configure authentication", "Monitor your application"

### Code Blocks
- Always specify language for syntax highlighting
- Use realistic, working examples
- Include necessary imports and setup
- Provide context for code snippets
- Use `bash` for shell commands, `python`/`typescript` for code

```python
import openlit

openlit.init(otlp_endpoint="http://127.0.0.1:4318")
```

### Links and References
- Use descriptive link text (avoid "click here")
- Link to relevant internal pages using relative paths
- Include external links where helpful
- Format: `[descriptive text](/path/to/page)` or `[external site](https://example.com)`

### Lists and Steps
- Use numbered lists for sequential steps
- Use bullet points for non-sequential items
- Keep list items parallel in structure
- Use the `<Steps>` component for multi-step processes

### Images and Media
- Store images in `/docs/images/`
- Use descriptive filenames
- Include alt text for accessibility
- Optimize file sizes
- Use videos for complex workflows when helpful

## Component Usage

### MDX Components
Use OpenLIT's custom MDX components consistently:

#### Steps Component
```mdx
<Steps>
  <Step title="Install OpenLIT">
    Content for step 1
  </Step>
  <Step title="Configure your application">
    Content for step 2
  </Step>
</Steps>
```

#### Tabs Component
```mdx
<Tabs>
  <Tab title="Python">
    Python-specific content
  </Tab>
  <Tab title="TypeScript">
    TypeScript-specific content
  </Tab>
</Tabs>
```

#### Cards and Card Groups
```mdx
<CardGroup cols={2}>
  <Card title="Feature Name" href="/path/to/page" icon="icon-name">
    Brief description of the feature
  </Card>
</CardGroup>
```

#### Info Boxes
```mdx
<Info>
Important information that helps users understand context
</Info>

<Tip>
Helpful tips and best practices
</Tip>

<Warning>
Important warnings about potential issues
</Warning>
```

#### Code Groups
```mdx
<CodeGroup>
```python OpenAI
# OpenAI example
```

```python Anthropic
# Anthropic example
```
</CodeGroup>
```

## Integration Documentation Patterns

### LLM/Framework Integration Pages
Follow this structure for integration documentation:

1. **Introduction**: Brief description of the integration
2. **Compatibility**: Supported versions and requirements
3. **Get started**: Installation and basic setup
4. **Configuration**: Advanced configuration options
5. **Examples**: Working code examples
6. **Related links**: Cards linking to quickstarts, configuration, destinations

### Standard Integration Template
```mdx
---
title: 'Monitor [Service] using OpenTelemetry'
sidebarTitle: '[Service Name]'
---

import IntegrationMethods from '/snippets/integration-methods.mdx';

Brief description of what this integration provides and its benefits.

Auto-instrumentation means you don't have to set up monitoring manually...

The integration is compatible with:
- [Service] version requirements

## Get started 

<Steps>
  <Step title="Install OpenLIT">
    Installation instructions with tabs for Python/TypeScript
  </Step>
  <IntegrationMethods />
</Steps>

---

<CardGroup cols={3}>
  <Card title="Quickstart: LLM Observability" href="/latest/sdk/quickstart-ai-observability" icon='bolt'>
    Production-ready AI monitoring setup in 2 simple steps with zero code changes
  </Card>
  <Card title="Configuration" href="/latest/sdk/configuration" icon='bolt'>
    Configure the OpenLIT SDK according to you requirements.
  </Card>
  <Card title="Destinations" href="/latest/sdk/destinations/overview" icon='link'>
    Send telemetry to Datadog, Grafana, New Relic, and other observability stacks
  </Card>
</CardGroup>
```

## Quickstart Documentation

### Structure for Quickstart Guides
1. **Mermaid diagram**: Show the architecture/flow
2. **Prerequisites**: What users need before starting
3. **Step-by-step instructions**: Clear, numbered steps
4. **Verification**: How to confirm everything works
5. **Next steps**: Where to go from here

### Standard Quickstart Elements
- Use `<Steps>` component for main workflow
- Include both Python and TypeScript examples where applicable
- Provide realistic, working code examples
- Include screenshots or videos for UI interactions
- End with verification steps and next actions

## Content Reuse and Snippets

### Snippet Usage
- Create reusable content in `/docs/snippets/`
- Import snippets using: `import SnippetName from '/snippets/snippet-name.mdx';`
- Use snippets for commonly repeated content like installation steps
- Keep snippets focused and modular

### Common Snippets
- Integration methods (`integration-methods.mdx`)
- Installation instructions
- Configuration patterns
- Kubernetes operator promotion cards

## Quality Checklist

Before publishing documentation:

### Content Quality
- [ ] Clear, descriptive title and description
- [ ] Logical flow from introduction to conclusion
- [ ] All code examples are tested and working
- [ ] Links are functional and point to correct destinations
- [ ] Grammar and spelling are correct
- [ ] Technical accuracy is verified

### Structure and Formatting
- [ ] Proper front matter included
- [ ] Headers follow logical hierarchy
- [ ] Code blocks have appropriate language tags
- [ ] Components are used correctly
- [ ] Images have alt text and are optimized

### User Experience
- [ ] Content is accessible to target audience
- [ ] Prerequisites are clearly stated
- [ ] Examples are realistic and helpful
- [ ] Next steps are provided
- [ ] Related content is linked appropriately

### Navigation and Discovery
- [ ] Page is added to `docs.json` navigation
- [ ] Appropriate cross-links are included
- [ ] Cards link to relevant related content
- [ ] Search-friendly titles and descriptions

## Brand and Voice Guidelines

### OpenLIT Brand Elements
- Use official OpenLIT orange color (#FFA500) in examples
- Include Kubernetes operator promotion cards where relevant
- Link to community resources (Slack, GitHub) appropriately
- Maintain consistent terminology across all documentation

### Technical Terminology
- "OpenLIT" (not "openlit" or "OpenLit")
- "AI observability" (preferred over "LLM monitoring")
- "OpenTelemetry" (not "OpenTel" or "OTEL" in user-facing content)
- "Zero-code instrumentation" (for automatic instrumentation)
- Use consistent service names (e.g., "OpenAI", "Anthropic", "LangChain")

## Maintenance and Updates

### Regular Review
- Update version compatibility information
- Verify all links and examples remain functional
- Update screenshots and videos as UI changes
- Review and update outdated information

### Version Management
- Keep compatibility matrices current
- Update installation instructions for new versions
- Maintain backward compatibility information where relevant
- Archive or redirect outdated content

---

## Quick Reference

When creating new documentation:

1. **Start with the template** appropriate for your content type
2. **Follow the structure** outlined in these rules
3. **Use components consistently** as shown in examples
4. **Test all code examples** before publishing
5. **Update navigation** in `docs.json`
6. **Review against checklist** before finalizing

Remember: Great documentation helps users succeed quickly and confidently with OpenLIT. Focus on clarity, accuracy, and user success.
