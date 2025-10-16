name: 🚀 Feature Request
description: Suggest a new feature for OpenLIT
title: "[Feature]: "
labels: [":rocket: Feature", ":raised_hand: Up for Grabs"]
body:
  - type: dropdown
    id: component
    attributes:
      label: Component
      description: Which part of the OpenLIT ecosystem?
      options:
        - OpenLIT
        - OpenLIT Python SDK
        - OpenLIT TS SDK
        - OpenLIT Operator
    validations:
      required: true

  - type: textarea
    id: feature-description
    attributes:
      label: What feature would you like to see?
      description: A clear description of the feature you want.
      placeholder: "Add support for..."
    validations:
      required: true

  - type: textarea
    id: why
    attributes:
      label: Why do you need this?
      description: Explain your use case and how this would help.
      placeholder: "I need this because..."
    validations:
      required: true

  - type: textarea
    id: additional
    attributes:
      label: Additional context
      description: Add any other context, screenshots, or examples.
      placeholder: "Here's an example..."
    validations:
      required: false

  - type: checkboxes
    id: checks
    attributes:
      label: Pre-submission checklist
      options:
        - label: I searched existing issues and didn't find a duplicate
          required: true
  - type: dropdown
    id: willing-to-submit-pr
    attributes:
      label: Are you willing to submit PR?
      description: This is absolutely not required, but we are happy to guide you in the contribution process.
      options:
        - "Yes, I am willing to submit a PR!"