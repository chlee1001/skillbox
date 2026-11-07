# skillbox

클론해 둔 스킬 레포를 프로젝트의 스킬 디렉토리에 **심볼릭 링크로** 깔고 관리하는 도구.
Claude Code·Codex·gajae-code를 지원한다. 내 git 클론이 단일 소스라서 `git pull` 한 번이면
링크된 모든 프로젝트가 최신화된다. CLI(스크립트·빠른 작업)와 TUI(대화형 관리 화면)를 둘 다 쓴다.

기존 도구로는 이 조합이 안 됐다 — vercel-labs/skills는 자기 사본으로 복사하고, stow는 이종
레이아웃을 못 잡는다. "내 클론 = 소스 + 이종 레이아웃 자동 탐지 + 프로젝트별 링크/해제"를
한 번에 하려고 직접 만들었다. 배경·설계는 상위 폴더의 `skill-manager-design.md`에 있다.

## 설치

Node ≥ 20, [Bun](https://bun.sh) 필요.

```bash
bun install
bun link          # 전역 `skillbox` 명령 등록 (선택; 안 하면 `bun src/cli.ts <명령>`)
```

기본 워크스페이스는 이 폴더의 부모(클론 레포가 모인 곳)다. `SKILLBOX_WORKSPACE`로 재정의한다.
워크스페이스 루트의 `.skillboxignore`(한 줄에 레포명)로 특정 레포를 목록에서 뺀다.
카테고리는 같은 자리의 `.skillboxcategory`(`<레포명> <카테고리>`)에 저장한다. `skillbox category`가 이 파일을 고친다.
레포 분류(external/owned)는 ① 루트 `.skillboxclass`(`<레포명> <external|owned>`) 명시가 최우선,
② 없으면 git remote origin의 owner로 추론(`ownedOwners` config, 기본 `chlee1001`), ③ remote가 없으면 owned(미백업)로 간주한다.

## CLI

```bash
# 대상 프로젝트를 별칭으로 등록 (한 번)
skillbox target add wp /path/to/project
skillbox target list
skillbox target rm wp

# 둘러보기
skillbox list                       # 워크스페이스 전체 스킬
skillbox list slides-grab           # 한 레포만 ([umbrella] = 하위 스킬을 품은 상위 스킬)
skillbox path create-prd            # 그 스킬의 SKILL.md 경로 (동명이면 repo:skill)

# 카테고리 (레포 단위, 안 묶어도 된다)
skillbox category                           # 카테고리별 레포와 묶지 않은 레포
skillbox category 디자인 taste-skill insane-design   # 묶기
skillbox category 디자인                      # 그 카테고리의 스킬 (= list --category 디자인)
skillbox category --off insane-design       # 풀기

# 항상 켜 두기 (모든 세션에 올라간다)
skillbox always                     # 지금 항상 켜진 스킬
skillbox always git-workflow        # 켜기
skillbox always --off git-workflow  # 끄기

# 버전 확인 (커밋 해시 기준)
skillbox outdated                   # upstream을 fetch해 HEAD와 최신 해시를 견준다

# 설치 / 제거 (심볼릭 링크)
skillbox install wp --repo slides-grab --all      # 레포 전체(하위 스킬만, umbrella 제외)
skillbox install wp slides-grab-plan              # 특정 스킬
skillbox install wp korean-privacy-terms:privacy-kr   # 동명 충돌 시 repo:skill로 지정
skillbox install wp --repo slides-grab --all --copy   # 링크 대신 복사(워크트리·공유용)
skillbox uninstall wp --all                       # 우리 링크만 안전 제거

# 상태 / 청소 / 레포 관리
skillbox status wp                  # ok / broken / extern(외부) / dir(실폴더)
skillbox prune wp                   # 원본이 사라진 우리 깨진 링크만 제거
skillbox update                     # external 클론만 git pull (owned는 스킵 — 로컬 커밋 보호)
skillbox update skillbox            # owned는 레포명을 명시해야 pull
skillbox add https://github.com/org/repo.git   # 워크스페이스에 클론
skillbox remove repo                # 안전한 external 클론 제거
skillbox list --archived            # 뺀 레포와 보관한 스킬 보기

# fleet 툴링(list --owned/--external · doctor · inventory · drift) → 아래 "Fleet 관리" 섹션
```

`<target>` = 별칭 · 경로 · `--user`(전역 유저 스코프).

### `--json`

`list`, `always`, `outdated`, `doctor`는 `--json`을 붙이면 표준 출력에 JSON 하나를 낸다. 다른 프로그램(예: Herdr 스킬 패널)이 이 출력을 읽는다. 종료 코드와 표준 오류의 에러 문구는 텍스트 출력과 같다. 다른 명령에 붙이면 코드 2로 거부한다. `list --archived --json`도 거부한다.

```bash
skillbox list --json        # { workspace, repos: [{ name, path, class, remote, unbacked, category, skills: [{ name, ref, path, description, umbrella, always }] }] }
skillbox always --json      # { targets: [{ target, skills: [{ name, repo, ref }] }], warning }
skillbox always <ref> --json        # { changes: [{ target, skill, ref, action, reason? }], warning }
skillbox outdated --offline --json  # { fetched, repos: [{ repo, class, remote, head, latest, status, behind, ahead, note? }] }
skillbox doctor --json      # { fetched, findings: [{ check, subject, detail }], verdict }
```

`ref`는 그 스킬 하나만 가리키는 선택자다. `always`, `install`, `path`에 그대로 넘기면 된다. 같은 레포에 이름이 같은 스킬이 여럿 있으면 `im-not-ai:codex/skills/humanize-korean`처럼 레포 안 경로를 쓴다. `description`은 SKILL.md에서 읽은 앞 200자다. 텍스트 출력처럼 70자에서 자르지 않는다.

### 에이전트 (Claude / Codex / gajae-code)

기본은 Claude Code(`.claude/skills/`)다. 플래그로 다른 에이전트 위치를 고른다.

```bash
skillbox install wp --repo slides-grab --all           # Claude:  <proj>/.claude/skills/
skillbox install wp --repo slides-grab --all --codex   # Codex:   <proj>/.agents/skills/
skillbox install wp --repo slides-grab --all --gajae   # gjc:     <proj>/.gjc/skills/
skillbox status --user --codex                         # ~/.agents/skills
```

| 에이전트 | 프로젝트 스코프 | 유저 스코프(`--user`) | 근거 |
|---|---|---|---|
| claude (기본) | `<proj>/.claude/skills/` | `~/.claude/skills/` | Claude Code |
| codex (`--codex`) | `<proj>/.agents/skills/` | `~/.agents/skills/` | OpenAI Codex "Build skills" 문서(cwd→repo root 스캔) |
| gajae (`--gajae`) | `<proj>/.gjc/skills/` | `~/.gjc/agent/skills/` | gjc `discovery/builtin.ts` loadSkills (project walk-up + user scan) |

세 경로 모두 각 에이전트의 실제 탐색 위치로 확인했다.

**주의 — gajae(gjc)는 스킬 스캔이 기본 OFF다.** 링크만 깔면 gjc가 못 본다. 켜야 한다.

```bash
gjc config set skills.enabled true          # 마스터 스위치
gjc config set skills.enablePiProject true  # 프로젝트 스킬(<proj>/.gjc/skills) — --gajae 기본
gjc config set skills.enablePiUser true     # 유저 스킬(~/.gjc/agent/skills) — --gajae --user
```

실제 설치한 스코프에 맞는 것만 켜면 된다(둘 다 켤 필요 없다). gjc는 `enableClaudeProject`·
`enableCodexUser` 등으로 claude·codex 위치도 읽으니, 이미 깐 다른 스코프를 재사용할 수도 있다.

같은 소스 스킬을 여러 에이전트에 **동시 설치**해도 된다(폴더가 달라 공존한다). 에이전트
프로파일은 `src/core/config.ts`의 `AGENTS` 한 곳에 있다(새 에이전트 = 행 하나 추가).

## 에이전트 세션에서 쓰기

진입점 스킬 `skills/skillbox`를 전역에 한 번 건다. 그러면 어느 세션에서든 "커밋 스킬 항상 켜줘",
"스킬 업데이트 확인해줘", "이 레포 스킬 추가해줘"처럼 말로 시키면 에이전트가 이 스킬을 열어 맞는
`skillbox` 명령을 실행한다. GJC는 스킬 설명을 프롬프트에 싣지 않으므로 같은 설명의 규칙도 건다.

```bash
skillbox always skillbox:skillbox   # Claude Code·Codex·GJC 스킬
ln -s "$PWD/skills/skillbox/gjc-rule.md" ~/.gjc/agent/rules/skillbox.md   # GJC 규칙
```

설명은 스킬 관리 요청에만 맞춰 두었다. PRD를 써 달라는 요청처럼 평소 작업에서는 열지 않는다.
스킬 설명을 바꾸면 `gjc-rule.md`의 `description`도 같이 바꾼다.

Codex를 샌드박스(`workspace-write`)로 돌리면 작업 폴더 밖에 쓰는 명령은 막힌다. 새로 켜기, 끄기,
`update`, `add`가 그렇다. `outdated`는 fetch가 막혀 `FETCH-FAILED`로 나온다. 이때는 승인하거나 터미널에서
직접 실행한다. 이미 켜진 스킬을 다시 켜는 명령은 아무것도 쓰지 않으므로(`already-linked`) 샌드박스에서도 된다.

### 이름으로 불러 쓰기

항상 켜 두지 않은 스킬은 필요할 때 이름으로 부른다.

| 에이전트 | 부르는 법 |
|---|---|
| Claude Code | `/skillbox create-prd 장보기 공유 PRD 써줘` |
| Codex | `$skillbox create-prd 장보기 공유 PRD 써줘` |
| GJC | `/skill:skillbox create-prd 장보기 공유 PRD 써줘` |

진입점 스킬은 `skillbox path <스킬>`로 경로를 얻어 그 SKILL.md를 읽고 따른다. 링크는 걸지 않는다.
이름을 모르면 요청만 넘긴다. 그러면 `skillbox list`에서 후보를 골라 보여 준다.

## 항상 켜 둘 스킬 (always)

커밋·PR처럼 부르지 않아도 알아서 써야 하는 스킬은 항상 켜 둔다. 켜 둔 스킬은 설명이 모든 세션의
컨텍스트에 올라가므로, 자주 쓰는 것만 켠다.

```bash
skillbox always git-workflow        # 커밋·PR·릴리스 PR 스킬
```

스킬 폴더 이름이 `skill`처럼 일반적이면 SKILL.md의 `name`을 스킬 이름으로 쓴다(없으면 상위 폴더 이름).

켜기는 사용자 스코프 폴더 `~/.claude/skills`(Claude Code)와 `~/.agents/skills`(Codex, GJC)에
링크를 거는 일이다. 두 폴더가 같은 곳을 가리키면 한 번만 건다. GJC는 `~/.agents/skills`를
`skills.customDirectories`에 넣어야 읽으므로, 빠져 있으면 `always`가 경고한다. GJC 자체
폴더(`~/.gjc/agent/skills`)에는 걸지 않는다. 걸면 GJC가 같은 스킬을 두 번 읽는다.

켜짐 여부는 따로 저장하지 않고 디스크의 링크에서 읽는다. 다른 도구(예: my-skills `setup.sh`)가 건
링크도 워크스페이스 안을 가리키면 켜진 것으로 본다. `skillbox list`는 켜진 스킬에 `[always]`를 붙인다.

자동으로 찾게 하는 방식은 2026-11-06에 재 보고 쓰지 않기로 했다. 진입점 스킬의 설명을
잘 써도 Claude Code는 8번 중 5번, GJC는 규칙 파일을 더해야 8번 중 6번만 찾았다. 코드를
바로 고치는 요청(성능, 디자인)은 거의 놓쳤다.

## 보관한 스킬

`skillbox list --archived`로 보관한 스킬과 뺀 레포를 본다. 항목마다 이름, 날짜(`등록 → 보관·제거`),
스킬 목록, 복원 방법이 네 줄로 나온다. 최신 항목이 위에 있다.

```
  taste-skill  ·  removed external repo
    dates    2026-07-19 → 2026-11-06
    skills   taste-skill  [1]
    restore  skillbox add https://github.com/leonxlnx/taste-skill.git
```

보관 폴더의 등록일은 git에 처음 기록된 날짜이고, 보관일은 `archive/`에 옮긴 날짜다.
복원하려면 레포에서 `git mv archive/<이름> <이름>`으로 폴더를 옮긴다. 항상 켜 둘 스킬이면
`skillbox always <스킬>`을 실행한다.

## Fleet 관리 (external vs owned)

fleet이 커지면 **external**(남의 upstream을 클론해 둔 것)과 **owned**(내가 만든 것)이 섞인다.
둘은 다루는 법이 다르다 — external은 `pull`로 따라가되 원본은 건드리지 않고, owned는 내가
`push`로 백업한다. 분류는 위 [설치](#설치)의 규칙을 쓴다(`.skillboxclass` → git remote owner →
remote 없으면 owned).

| 명령 | 하는 일 |
|---|---|
| `skillbox list --owned` · `--external` | 클래스로 거른다. 레포 줄에 클래스와 remote URL이 나온다. `UNBACKED` 태그는 remote 없는 owned(=백업 안 됨) |
| `skillbox remove <repo>` | external 클론을 지우고 `.skillboxremoved`에 날짜, 스킬, 복원 URL을 기록한다. 변경 사항이나 미푸시 커밋이 있으면 거부한다. `--force`는 이 검사를 건너뛴다. 항상 켠 스킬은 먼저 꺼야 한다. owned는 `archive/`에 보관한다 |
| `skillbox list --archived [repo]` | 뺀 레포와 `archive/`에 보관한 스킬을 날짜순으로 보여 준다. 뺀 레포는 표시된 `skillbox add <url>`로 복원한다 |
| `skillbox outdated [--offline]` | remote가 있는 레포마다 fetch한 뒤 로컬 HEAD 해시와 upstream 해시를 견준다. `CURRENT` · `BEHIND`(+N) · `LOCAL`(로컬 커밋·수정) · `NO-UPSTREAM` · `FETCH-FAILED`. BEHIND가 있으면 `exit 1`. `--offline`이면 fetch 없이 마지막으로 받은 해시로 본다 |
| `skillbox update` (bare/`--all`/`--external`) | **external만** `git pull --ff-only`. 레포마다 `이전 해시 -> 새 해시`를 찍는다. owned는 건너뛴다(로컬 커밋 보호) — owned는 레포명을 적어야 pull |
| `skillbox doctor [--fetch]` | fleet 건강을 판정한다 → 미백업 owned · external 로컬오염·드리프트 · 깨진 링크. `exit 0 HEALTHY / 1 WARN`. `--fetch`면 판정 전에 upstream을 실제로 확인한다(기본은 오프라인) |
| `skillbox inventory [--write]` | 스킬 × class × remote × 설치처 표를 stdout에 찍는다. `--write`면 워크스페이스 `INVENTORY.md`로 저장 |
| `skillbox drift` | owned의 `upstreams.json` pin(고정 커밋)을 external 현재 HEAD와 견준다. 고치지 않고 **보고만** 한다. CURRENT가 아니면 `exit 1` |

`doctor`는 주기 점검이나 CI에 건다 — exit 1이면 손볼 게 있다는 뜻이고, 특히 백업 안 된 owned를
잡아준다. `drift`는 owned 스킬이 external 계약에 기댄 때 쓴다 — owned 레포가 `upstreams.json`에
`insane-design` 같은 external을 pin해 두면 그 upstream이 움직였는지 알려준다(overlay `reabsorb`의
가벼운 판). 처음 쓰던 design-orchestrator는 2026-11-06에 my-skills 레포의 `archive/`로 옮겼다. 스캔은 어느 레포에서든 `archive/` 폴더 아래를 건너뛴다.

## TUI

실제 터미널에서 실행한다.

```bash
skillbox ui
```

- **대시보드**: 레포 이름, 소유 구분(owned/external), 카테고리, 전체·항상 켠 스킬 수, git 상태, upstream 대비 버전 상태를 표시한다. 버전 상태는 기본적으로 로컬 참조를 기준으로 한다. `↑↓` 이동 · `Enter` 열기 · `u` pull · `f` fetch 후 버전 확인 · `r` 새로고침 · `h` 헬스 · `q` 종료.
- **스킬×타깃**: 항상 켠 스킬에 `always`를 표시한다. `space` 링크 토글 · `t` 타깃 전환 · `c` 복사모드 · `esc` 뒤로.
- **헬스**: `p` 깨진 링크 청소 · `esc` 뒤로.

글리프: `[x]` 링크됨 · `[o]` umbrella로 커버됨(토글 막힘) · `[!]` 실폴더/충돌 · `[~]` 외부링크 · `[ ]` 미설치.
`q`·`Ctrl-C` 어느 쪽으로 나가도 터미널은 복원된다. (TUI 타깃은 claude 스코프 기준이다 —
codex·gajae 전환은 CLI로 한다.)

## 안전 규칙

- 워크스페이스를 가리키는 **우리 심볼릭 링크만** 제거한다. 외부 링크·실폴더는 표시만 하고 안 건드린다.
- 동명의 다른 스킬 링크를 덮어쓰지 않는다(install·uninstall 양쪽에서 src를 대조한다).
- 실폴더가 있으면 `--force` 없이는 거부하고, `--force`면 삭제가 아니라 `.bak-<시각>`으로 백업하고 교체한다.
- 설치 상태는 별도 DB 없이 **디스크의 심볼릭 링크에서 실시간 파생**한다(stateless).

## 구조

```
src/core/   UI 무관 헤드리스 — scan(이종 레이아웃 탐지) · link(matrix·링크·가드) ·
            config(RawConfig/Config 분리) · select · git · util · types
src/ui/     Ink TUI — actions(유일한 코어 어댑터) · keymap(순수 key→intent) ·
            altScreen · App(화면 상태기계) · SkillBrowser · Dashboard · Health
src/cli.ts  비대화형 명령
```

코어는 React/ink를 모른다. UI는 `actions.ts`를 통해서만 코어를 부른다(테스트로 강제한다).

## 개발

```bash
bun test                                    # 48개
bunx tsc --noEmit --noUnusedLocals          # 타입 + 데드코드 체크
```

`useInput`은 ink-testing-library + Bun에서 안 돌아간다. 그래서 키보드 로직은 순수 `keymap`
단위테스트로 덮고, 실제 대화형 조작은 `SMOKE.md`의 수동 TTY 체크리스트로 확인한다.

## 로드맵

- ✅ **fleet 툴링**(external/owned 분류 · `update --external` · `doctor` · `inventory` · `drift`) — 완료
- git `fetch` 배선: `doctor --fetch`는 됨, 남은 건 TUI 대시보드 ahead/behind 상시 정확도
- TUI 에이전트 전환 + 타깃 피커(현재 `h`는 첫 타깃 헬스)
- `bun build --compile` 단일 바이너리
