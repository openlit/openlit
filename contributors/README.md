# Contributors Guide

This directory contains comprehensive guides for contributing to the OpenLIT project. These guides provide detailed instructions, patterns, and best practices for extending OpenLIT's capabilities.

## Available Guides

### 📊 [Vector Database Instrumentation Guide](./vector-database-instrumentation-guide.md)
Complete guide for adding new vector database instrumentations to OpenLIT, including:
- File structure and organization
- Code patterns and conventions
- Implementation steps
- Testing guidelines
- Integration requirements

## Contributing Guidelines

When contributing to OpenLIT, please:

1. **Follow the established patterns** - Use the guides in this directory to maintain consistency
2. **Test thoroughly** - Include both sync and async tests with proper error handling
3. **Document changes** - Update guides if you introduce new patterns or conventions
4. **Review existing implementations** - Use existing instrumentations as reference examples

## Code Standards

All contributions must follow:
- **Consistent file structure** - 4-file pattern for instrumentations
- **Proper naming conventions** - snake_case for functions/variables, PascalCase for classes
- **Code style guidelines** - Double quotes, 4-space indentation, proper import order
- **Error handling** - Graceful handling of rate limits and API errors
- **OpenTelemetry compliance** - Proper span management and semantic conventions

## Getting Help

If you have questions about contributing:
1. Check the relevant guide in this directory
2. Review existing implementations for reference
3. Open an issue for discussion if needed

## Future Guides

This directory will be expanded with additional guides covering:
- LLM Provider Instrumentation
- Custom Metrics Implementation
- Testing Best Practices
- Performance Optimization

---

**Note**: These guides are living documents that evolve with the project. Please help keep them updated as patterns and conventions change. 