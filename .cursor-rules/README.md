# Cursor Rules Organization

This directory contains organized cursor rules for different aspects of the OpenLIT project.

## Current Rule Files

### `documentation.md`
**Purpose**: Guidelines for creating and maintaining OpenLIT documentation  
**Applies to**: 
- All files in `/docs/` directory
- MDX files (`.mdx`)
- README files
- API documentation
- Integration guides
- Quickstart tutorials

**Key Features**:
- File organization and naming conventions
- MDX component usage guidelines
- Content structure templates
- Brand and voice guidelines
- Quality checklists

### `frontend.md`
**Purpose**: Guidelines for OpenLIT client UI work  
**Applies to**:
- Settings pages
- Telemetry-style pages
- Header switchers and breadcrumbs
- Client stores, selectors, and helpers

**Key Features**:
- Light and dark mode styling standards
- Compact operational UI guidance
- Project hierarchy UI expectations
- Message key requirements

### `security-testing.md`
**Purpose**: Security and testing standards for API, auth, project hierarchy, and paid-feature boundaries  
**Applies to**:
- API routes
- Library mutations
- Audit, billing, licensing, and entitlement checks
- Tests under `src/client/src/__tests__`

**Key Features**:
- Server-side authorization requirements
- Invalid JSON handling
- Secret redaction requirements
- Project-scoped DB config test expectations

## File Naming Convention

Use descriptive names that clearly indicate the purpose and scope:
- `documentation.md` - Documentation writing and structure
- `frontend.md` - Frontend development (React, TypeScript, UI components)
- `backend.md` - Backend development (Go, Python, APIs)
- `testing.md` - Testing standards and practices
- `deployment.md` - Deployment and infrastructure
- `security.md` - Security guidelines and best practices

## Rule File Structure

Each rule file should follow this structure:

```markdown
# [Category] Cursor Rules

## Overview
Brief description of what this rule file covers

## [Section 1]
### Subsection
Guidelines and examples

## [Section 2]
### Subsection
More guidelines

## Quality Checklist
- [ ] Checklist items for quality assurance

## Quick Reference
Summary of key points
```

## Adding New Rules

1. Create a new `.md` file in this directory
2. Follow the established structure and format
3. Update the main `.cursorrules` file to reference the new category
4. Update this README to document the new rule file

## Best Practices

- Keep rules specific and actionable
- Include code examples where helpful
- Provide templates for common patterns
- Include quality checklists
- Regular review and updates as the project evolves
