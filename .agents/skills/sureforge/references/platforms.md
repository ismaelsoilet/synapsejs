# Platform notes

External documentation consulted: **2026-09-08**. Local Devin CLI paths and exposed tool schemas rechecked: **2026-09-09**. These notes are capability guidance, not a claim that SureForge has been behaviorally tested on every host. Tool names, context inheritance, discovery paths, and permission controls can change. Inspect the current host schema before use.

## Portable core

SureForge uses standard `name`, `description`, `license`, and string-valued `metadata` frontmatter. It does not set experimental `allowed-tools`, a model, automatic subagent execution, hooks, or platform-specific permissions. The installed package contains instructions and templates, not a runtime gatekeeper.

The distribution source is `skills/sureforge/`. An installation directory is a separate concern. Copy the complete skill directory, including its license and referenced resources; copying only SKILL.md is incomplete. Do not edit global configuration or overwrite an existing skill to conduct a smoke test.

## Capability matrix

| Host | Documented capability and cautions | SureForge adaptation | Behavioral status |
| --- | --- | --- | --- |
| Devin CLI | Version 3000.6.14 was inspected on 2026-09-09. Preferred paths are `.devin/skills/` and `~/.config/devin/skills/`. Its path command also lists `.cognition/skills/`, `.agents/skills/`, `~/.config/cognition/skills/`, and `~/.agents/skills/` as compatibility locations. | Use the current question schema and an authorized fresh reviewer or neutral handoff. Keep new Devin configuration in Devin directories; compatibility discovery is not a recommendation to write other tool configurations. | Require run-specific behavioral evidence; path discovery is a narrower check. |
| Claude Code | Current subagent documentation distinguishes dedicated contexts from conversation forks. Subagents can delegate within host depth/tool limits; inherited project instructions and permissions still matter. | Do not equate any fork with blind review or assume nested delegation is impossible. Inspect context construction and restrict writes/delegation using real controls. The reviewer brief also forbids further agents. | Require run-specific behavioral evidence; no general compatibility claim. |
| Codex | Skill documentation describes explicit selection and description-based activation, progressive disclosure, and repository/user discovery under `.agents/skills`. Question/delegation availability depends on the product and mode. | Discover actual tools rather than assuming `request_user_input` is available. Use a genuinely fresh authorized session when the current host cannot provide an independent reviewer. | Require run-specific behavioral evidence; no general compatibility claim. |
| Cursor | Documentation lists `.agents/skills/` and `.cursor/skills/` discovery. The pinned Skills CLI uses `.agents/skills/` as a shared project installation target for Cursor and Codex. A message-attached skill differs from a session-wide custom mode. | Verify discovery and continued activation separately. Use the available question mechanism; do not modify modes or permissions without approval. | Require run-specific behavioral evidence; a shared directory is not proof of shared behavior. |
| Hermes Agent | Documentation describes `skill_view`, progressive resource loading, a primary user skill directory, external directories, and `delegate_task` with fresh conversations plus inherited tool access and project context. | Inspect the live `clarify` schema and interface; grouping support is surface-dependent. Reviewer read-only is not guaranteed by a prompt when terminal/write tools are inherited. Do not assume a convenience `/review` command supplies the desired neutral context. | Require run-specific behavioral evidence; no general compatibility claim. |

File installation and discovery can be tested without exercising model behavior. Keep those results separate from this column. No platform receives a behavioral compatibility badge based only on documentation or copied files.

## Questions

Use the actual tool exposed by the host, not a guessed function call. Devin CLI 3000.6.14 exposed `ask_user_question` with one to four questions and two to four predefined options per question when inspected on 2026-09-09; other hosts and versions differ. Hermes documentation and interfaces support `clarify`, but numeric limits must be read from the live schema. On hosts with no question tool, use the numbered text fallback. A skipped question remains unanswered in every interface.

## Review isolation checklist

Before counting an independent reviewer, establish:

1. Whether conversation history, summaries, project rules, memories, skills, or author reports are inherited.
2. Whether the reviewed snapshot is stable and accessible with its latest contract and necessary materials.
3. Whether write, network/provider, and delegation permissions fit the approved scope.
4. Whether the reviewer can report actual methods and coverage, not merely a verdict.
5. Whether the provider/data destination and resource use are authorized.

If any property is unknown, disclose it. Do not launch a second CLI to bypass a host restriction on subagents. A handoff to a separately authorized human or fresh session is the fallback for required independent review.

## Local installer verification

The repository's local smoke-test procedure targets **`skills@1.5.23`**, published 2026-08-18, with telemetry disabled. The installer is external test tooling, not a SureForge runtime dependency. Check its documented agent targets and flags on that exact version. A later installer may discover more source paths; do not repeat historical omissions of `.devin/skills` as permanent facts.

Use an isolated project and an explicitly selected target. The repository's local test installs into an isolated project for the five CLI targets (`claude-code`, `cursor`, `codex`, `devin`, `hermes-agent`; Cursor and Codex share `.agents/skills/`) and compares every installed file with the source. It does not install into the owner's real global skill directories. Installation from the public repository is a separate check made against each tagged release and recorded in that release's notes; a copy of this file cannot prove that the remote command works for the version you hold.

For another host, consult its current documented directories, install into an approved isolated profile/project, verify discovery, then run a real task in a clean context. Hermes' documented primary directory and external-directory settings should be checked rather than assuming every installer project target is automatically loaded by every Hermes version.

## Sources

- [Agent Skills specification](https://agentskills.io/specification)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Codex skill authoring and discovery](https://developers.openai.com/codex/skills.md)
- [Cursor skills](https://cursor.com/docs/context/skills)
- [Hermes skills system](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
- [Skills installer](https://github.com/vercel-labs/skills)

The Devin-specific statements were checked against Devin CLI 3000.6.14 documentation, exposed tool schemas, and `devin skills paths` on 2026-09-09. The installer-directory statements refer to Skills CLI 1.5.23. These dated observations do not establish behavior on another host or release.
