# Repository agent instructions

## Do not use this repository's Skill suite on itself

When working in this repository, **do not invoke or follow `orchestrate-engineering-team` or any of its bundled role Skills to plan, implement, test, or review changes to this repository**.

This prohibition includes:

- `orchestrate-engineering-team`
- `architect-work-item`
- `develop-work-item`
- `test-product-work-item`
- `review-work-item`
- any renamed, copied, installed, or compatibility form of those Skills

Do not create or maintain `.agent-work/` state for repository development, do not dispatch the suite's Main/Architecture/Development/Product Test/Review roles, and do not use the suite's workflow as the process governing its own modification.

Use the host agent's ordinary single-agent workflow and independent general-purpose review/testing tools instead. The suite's scripts and Skills may be executed only as the **system under test** in disposable fixtures or explicit validation commands; executing them for tests does not authorize using them to coordinate the repository change itself.

This rule is mandatory even when a change would normally qualify for multi-agent orchestration. It prevents the product under development from controlling or validating its own development process.
