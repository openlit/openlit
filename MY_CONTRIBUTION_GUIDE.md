# My OpenLIT Contribution Guide

## 🚀 Quick Setup

### 1. Development Environment Setup

#### Option A: Full Stack Development (Frontend + Backend)
```bash
# Navigate to src directory
cd src

# Start development environment with Docker Compose
docker compose -f dev-docker-compose.yml up --build -d

# Access OpenLIT at http://localhost:3000
```

#### Option B: Frontend Only Development
```bash
cd src/client

# Install dependencies
npm install

# Run development server
npm run dev
```

#### Option C: Python SDK Development
```bash
cd sdk/python

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install in editable mode
pip install -e .

# Run tests
pytest tests/
```

#### Option D: TypeScript SDK Development
```bash
cd sdk/typescript

# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test
```

## 📝 Contribution Workflow

### Step 1: Create a Feature Branch
```bash
# Always create a new branch for your work
git checkout -b feature/my-awesome-feature

# Or for bug fixes
git checkout -b fix/bug-description
```

### Step 2: Make Your Changes
- Write clean, well-documented code
- Follow the existing code style
- Add tests for new features
- Update documentation if needed

### Step 3: Test Your Changes
```bash
# For Python SDK
cd sdk/python
pytest tests/

# For TypeScript/Frontend
cd src/client
npm run lint
npm run build
```

### Step 4: Commit Your Changes
```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat: add support for new LLM provider"
```

Use conventional commit messages:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `test:` for adding tests
- `refactor:` for code refactoring

### Step 5: Push and Create Pull Request
```bash
# Push to your fork
git push origin feature/my-awesome-feature
```

Then go to GitHub and create a Pull Request!

## 🎯 Good First Contribution Ideas

### Easy (Good for First Contribution)
1. **Fix Documentation Typos** - Find and fix typos in README or docs
2. **Add Code Comments** - Improve code documentation
3. **Update Examples** - Add more usage examples
4. **Improve Error Messages** - Make error messages more helpful

### Medium (After Getting Familiar)
1. **Fix TODOs** - Address TODO comments in the codebase
2. **Add Unit Tests** - Improve test coverage
3. **Add New LLM Provider** - Integrate a new AI provider
4. **UI Improvements** - Enhance dashboard components

### Advanced (After Contributing a Few Times)
1. **New Features** - Implement feature requests from issues
2. **Performance Optimizations** - Improve speed and efficiency
3. **Architecture Improvements** - Refactor and improve design

## 🐛 Found a Bug?

1. Check if the bug is already reported in [GitHub Issues](https://github.com/openlit/openlit/issues)
2. If not, create a new issue with:
   - Clear bug description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots (if applicable)
   - Environment details

## 💡 Quick Tips

- **Start Small**: Begin with documentation or small bug fixes
- **Ask Questions**: Use GitHub Discussions or Slack channel
- **Read Existing Code**: Learn from how things are currently done
- **Test Locally**: Always test before submitting PR
- **Stay Patient**: Reviews may take time

## 📚 Useful Commands

### Git Commands
```bash
# Keep your fork updated with main repo
git remote add upstream https://github.com/openlit/openlit.git
git fetch upstream
git merge upstream/main

# Check status
git status

# View changes
git diff
```

### Docker Commands
```bash
# View running containers
docker ps

# View logs
docker compose -f src/dev-docker-compose.yml logs -f

# Stop containers
docker compose -f src/dev-docker-compose.yml down

# Remove all data and start fresh
docker compose -f src/dev-docker-compose.yml down -v
```

## 🎉 After Your First PR is Merged

Congratulations! You're now an OpenLIT contributor! 🎊

Next steps:
1. Share your contribution on Twitter/LinkedIn
2. Look for more issues labeled "good first issue"
3. Help review other contributors' PRs
4. Join the community Slack channel

---

**Remember**: Every expert was once a beginner. Don't hesitate to ask questions!

Happy Contributing! 🚀
