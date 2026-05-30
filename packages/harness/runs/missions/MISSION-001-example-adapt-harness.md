# Mission: Adapt Harness To Current Project

Status: example  
Priority: high  
Related ADR: docs/adrs/ADR-001-agentic-control-plane.md  
Related Spec: docs/specs/SPEC-001-control-plane-lifecycle.md  

## Goal

Customize the harness state and docs for this project without changing application code.

## Allowed Files

- AGENTS.md
- CLAUDE.md
- README.md
- CHANGELOG.md
- .gitignore
- .harness/**
- .claude/**
- docs/**
- agents/**
- pipelines/**
- adapters/**
- prompts/**
- tools/**
- tests/**

## Forbidden Files

- application source files
- package lockfiles
- migrations
- infrastructure files

## Acceptance Criteria

- [ ] project mode set
- [ ] project state updated
- [ ] context manifest updated
- [ ] first risks documented
- [ ] first next action recommended
