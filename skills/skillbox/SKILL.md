---
name: skillbox
description: "스킬 관리 요청에 쓴다: 스킬 항상 켜기·끄기, 업데이트·버전 확인, 새 스킬 레포 추가, 목록과 출처(직접 만든 것인지 upstream이 있는지) 확인, 뺀·보관한 스킬 보기, skillbox 설정 변경. 사용자가 /skillbox <스킬>로 지목하면 그 스킬을 불러 쓴다. 일반 작업에 맞는 스킬을 찾으려고 스스로 열지 않는다."
---

# skillbox

`skillbox` CLI로 이 컴퓨터의 스킬 워크스페이스를 관리한다. 인자 없이 `skillbox`를 실행하면 명령 전체와 워크스페이스 경로가 나온다. 동작의 자세한 설명은 이 파일 기준 `../../README.md`에 있다.

## 요청별 명령

| 요청 | 명령 |
|---|---|
| 목록, 출처 | `skillbox list [레포]`. 레포 줄의 `[owned]`는 직접 만든 것, `[external <URL>]`은 upstream을 클론한 것이다. 스킬 줄의 `[always]`는 항상 켜진 것이다. |
| 뺀·보관한 스킬 보기, 예전에 쓰던 스킬 찾기 | `skillbox list --archived` |
| 카테고리 보기 | `skillbox category` (전체), `skillbox category <이름>` (그 카테고리의 스킬) |
| 카테고리 묶기 / 풀기 | `skillbox category <이름> <레포...>` / `skillbox category --off <레포...>` (레포 단위, 안 묶어도 된다) |
| 항상 켜기 | `skillbox always <스킬>` |
| 끄기 | `skillbox always --off <스킬>` |
| 지금 켜진 것 | `skillbox always` |
| 버전 확인 | `skillbox outdated` (커밋 해시 비교, `BEHIND`면 뒤처짐) |
| 업데이트 | `skillbox update` (external 전부) 또는 `skillbox update <레포>` (owned도 하나씩) |
| 새 스킬 레포 추가 | `skillbox add <git-url>` 뒤 `skillbox list <레포>` |
| 레포 빼기 | `skillbox remove <레포>` (external만, 변경 사항과 미푸시 커밋이 없어야 한다) |
| 점검 | `skillbox doctor`, `skillbox drift` |
| 스킬 하나 불러 쓰기 | 아래 "이름으로 불러 쓰기" |

## 지킬 것

- `ambiguous`로 거부되면 `레포:스킬`로 다시 실행한다. 어느 쪽인지 모르면 후보를 보여 주고 사용자에게 고르게 한다.
- 업데이트 전에 `skillbox outdated`로 바뀔 레포와 해시를 보여 준다. 업데이트 뒤에는 `이전 -> 새 해시`와 `skillbox drift` 결과를 보고한다.
- 항상 켠 스킬의 설명은 모든 세션의 컨텍스트에 올라간다. 켤 때 이 점을 한 줄로 알린다.
- external 레포의 파일은 고치지 않는다. 고칠 스킬은 owned 레포로 옮긴다.
- 직접 만드는 새 스킬은 owned 레포(예: `my-skills`) 안에 `<이름>/SKILL.md`로 만든다. 워크스페이스 안에 있으면 skillbox가 바로 찾는다.
- 설정은 `~/.config/skillbox/config.json`(워크스페이스, 대상 별칭, `ownedOwners`)과 워크스페이스 루트의 파일들에 있다. `.skillboxclass`는 분류를 직접 지정하고, `.skillboxignore`는 목록에서 뺄 레포, `.skillboxcategory`는 카테고리다. 카테고리는 파일을 직접 고치지 말고 `skillbox category`로 바꾼다.
- 쓰기 권한 때문에 명령이 막히면 실행할 명령을 그대로 보여 주고 승인을 받는다.
- 커밋과 푸시는 사용자가 요청할 때만 한다.

## 이름으로 불러 쓰기

사용자가 `/skillbox <스킬> <요청>`(Codex `$skillbox`, GJC `/skill:skillbox`)으로 부르면 그 스킬의 지침을 이번 작업에만 따른다. 링크를 걸지 않는다.

1. 첫 명령은 `skillbox path <스킬 또는 레포>`다. `skill_discovery`, `find`, `ls`로 먼저 찾지 않는다. 나온 SKILL.md 경로를 끝까지 읽는다. 요약이나 앞부분만 보고 진행하지 않는다(GJC는 `<경로>:raw`로 읽는다).
   - 그 SKILL.md의 상대 경로와 `${CLAUDE_SKILL_DIR}`는 그 SKILL.md가 있는 폴더다. 셸에서 쓰는 명령이면 `CLAUDE_SKILL_DIR=<그 폴더>`를 먼저 정한다.
   - 다른 에이전트용 도구 이름(`Agent`, `Task`, `Glob` 등)은 지금 쓰는 에이전트의 같은 기능으로 바꿔 따른다. 하위 에이전트를 이름으로 부르라고 하면 그 정의 파일(예: 레포의 `agents/<이름>.md`)을 읽게 해서 하위 에이전트에 맡긴다.
   - 스크립트·검증 단계는 건너뛰지 않는다. 실행할 수 없으면 무엇을 못 했는지 보고한다.
2. 레포 이름을 넘기면 스킬이 하나인 레포(`skillbox에서 last30days-skill 써줘`)는 `path`가 그 스킬 경로를 바로 준다. 스킬이 여럿인 레포(`skillbox im-not-ai로 윤문해줘`)는 후보를 `레포:경로`로 보여 주고 거부한다. 요청에 맞는 것을 골라 다시 실행한다. 같은 이름이 `skills/`와 `codex/`·`copilot/` 아래에 있으면 `skills/` 쪽을 쓴다.
3. `not found`면 `skillbox list`에서 후보를 찾는다. 하나면 그것을 쓰고, 둘 이상이면 보여 주고 고르게 한다.
4. 최종 보고 첫 줄에 `skillbox: <스킬>`을 적는다.

`skillbox` 명령이 없으면 그렇게 알리고 멈춘다.
