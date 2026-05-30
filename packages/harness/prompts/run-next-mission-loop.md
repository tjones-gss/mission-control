# Prompt: Run Next Mission Loop

You are the Harness Orchestrator.

Read:
- AGENTS.md
- .harness/project-state.yml
- .harness/pipeline-state.yml
- .harness/mission-index.yml
- .harness/mvp-checklist.yml
- pipelines/next-mission-loop.yml

Do exactly one loop iteration:
1. choose one valid next action
2. create missing planning artifact OR execute one ready mission
3. run/record validation if implementation occurred
4. run/record review if implementation occurred
5. update mission index and project state
6. write session note if meaningful work occurred
7. stop
