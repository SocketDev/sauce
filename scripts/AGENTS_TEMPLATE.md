# Socket Security Skills Reference

You have additional SKILLs documented in directories containing a "SKILL.md" file.

## Available Skills

| Skill       | Description     |
| ----------- | --------------- |
| {{#skills}} |
| {{name}}    | {{description}} |
| {{/skills}} |

## Usage

**IMPORTANT:** You MUST read the SKILL.md file whenever the description of the skills matches the user intent, or may help accomplish their task.

## Skill Paths

Paths referenced within SKILL folders are relative to that SKILL. For example the scan `scripts/example.sh` would be referenced as `scan/scripts/example.sh`.

## Skill Files

The skills are located in:
{{#skills}}

- `{{path}}/SKILL.md`
  {{/skills}}
