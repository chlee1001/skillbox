---
name: skillbox
description: >
  이 머신에는 skillbox(전역 CLI)가 클론해 둔 스킬 레포 묶음을 관리한다. 지금 세션에 안 붙어 있지만
  워크스페이스에 존재하는 스킬이 필요할 때, 재구현하지 말고 skillbox로 현재 작업 폴더에 on-demand로
  붙여 쓴다. 디자인·리서치·문서 등 특정 능력이 필요한데 로드돼 있지 않을 때 먼저 이 스킬로 확인한다.
  Triggers: "스킬 붙여줘", "skillbox로 붙여", "필요한 스킬 attach", "이 작업에 맞는 스킬 있어?",
  "skillbox list", "attach skill", "provision skill".
triggers:
  - skillbox로 붙여
  - 필요한 스킬 붙여줘
  - attach skill via skillbox
  - 이 작업에 맞는 스킬 있어
---

# skillbox — on-demand 스킬 프로비저닝

이 머신에는 전역 `skillbox` CLI가 있고, `claude-skills/` 워크스페이스에 클론된 스킬 레포들을 관리한다.
클론이 단일 소스라 `skillbox update`로 한 번에 최신화되고, 프로젝트별 `.claude/skills/`에 **심볼릭 링크**로 붙는다.

## 언제 쓰나 (핵심 원칙)
어떤 능력이 필요한데 **지금 세션에 로드돼 있지 않다**면, 바닥부터 짜기 전에 먼저 **워크스페이스에 그 스킬이 이미 있는지** 확인한다. 있으면 재구현하지 말고 붙여 쓴다. (code-minimalism 사다리 2번 — "이미 있는 걸 재구현하지 마라"의 스킬 판.)

## 흐름

```bash
# 1) 이 작업에 맞는 스킬이 워크스페이스에 있나
skillbox list                      # 전체
skillbox list <repo>               # 한 레포만

# 2) 현재 프로젝트를 타깃으로 (별칭 등록은 1회, 이후 재사용)
skillbox target add <별칭> "$(pwd)"     # 또는 기존 별칭/경로/--user 사용
skillbox target list

# 3) 붙이기 (심볼릭 링크 — 원본 수정 없음)
skillbox install <별칭> <skill>              # 특정 스킬 하나
skillbox install <별칭> --repo <repo> --all  # 레포의 하위 스킬 전체
skillbox install <별칭> <repo>:<skill>       # 동명 충돌 시

# 4) 상태 / 정리
skillbox status <별칭>              # ok / broken / extern / dir
skillbox uninstall <별칭> <skill>   # 우리 링크만 안전 제거
```

에이전트(기본 Claude): `.claude/skills/`. Codex `--codex`(`.agents/skills`), gajae `--gajae`(`.gjc/skills`).

## 규칙
- **붙일 스킬을 한두 개로 좁힌다.** `--all`로 통째 붙이면 컨텍스트가 무거워지고 성향이 겹친다. 작업에 필요한 최소만.
- **붙였으면 실제로 그 스킬의 SKILL.md를 읽고 따른다.** 링크만 걸고 무시하지 말 것.
- **일회성이면 끝나고 `uninstall`.** 프로젝트에 계속 둘 거면 남긴다(심링크라 `skillbox update`로 자동 최신화).
- skillbox는 **워크스페이스 내부로 resolve되는 링크만** 제거한다. 실폴더/외부 링크는 `--force` 없이 안 건드린다.

## 대표 사례 — 디자인 작업
UI 화면을 기존 스타일에 맞춰 만들거나 확장할 때는 개별 도구를 따로 붙이지 말고 **오케스트레이터 하나**를 붙인다:

```bash
skillbox install <별칭> design-orchestrator
```

`design-orchestrator`가 insane-design(값 추출·잠금) + design-discovery 로직(의도/값 분리) + taste-skill(배치·마감)을 한 흐름으로 엮는다. 자세한 건 그 스킬의 SKILL.md 참조.

## 배경
skillbox 도구 자체·설계는 `claude-skills/skillbox/`(README + `skill-manager-design.md`)에 있다. 이 스킬은 그 CLI를 **에이전트가 필요할 때 스스로 쓰게** 하는 얇은 진입점이다 — 능력을 코어에 박아두는 대신, 필요한 곳에서 조립한다.
