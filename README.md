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

## CLI

```bash
# 대상 프로젝트를 별칭으로 등록 (한 번)
skillbox target add wp /path/to/project
skillbox target list
skillbox target rm wp

# 둘러보기
skillbox list                       # 워크스페이스 전체 스킬
skillbox list slides-grab           # 한 레포만 ([umbrella] = 하위 스킬을 품은 상위 스킬)

# 설치 / 제거 (심볼릭 링크)
skillbox install wp --repo slides-grab --all      # 레포 전체(하위 스킬만, umbrella 제외)
skillbox install wp slides-grab-plan              # 특정 스킬
skillbox install wp korean-privacy-terms:privacy-kr   # 동명 충돌 시 repo:skill로 지정
skillbox install wp --repo slides-grab --all --copy   # 링크 대신 복사(워크트리·공유용)
skillbox uninstall wp --all                       # 우리 링크만 안전 제거

# 상태 / 청소 / 레포 관리
skillbox status wp                  # ok / broken / extern(외부) / dir(실폴더)
skillbox prune wp                   # 원본이 사라진 우리 깨진 링크만 제거
skillbox update --all               # 전 레포 git pull (링크 자동 최신화)
skillbox add https://github.com/org/repo.git   # 워크스페이스에 클론
```

`<target>` = 별칭 · 경로 · `--user`(전역 유저 스코프).

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

## TUI

실제 터미널에서 실행한다.

```bash
skillbox ui
```

- **대시보드**: 레포 + 스킬 수 + git 상태. `↑↓` 이동 · `Enter` 열기 · `u` pull · `r` 새로고침 · `h` 헬스 · `q` 종료.
- **스킬×타깃**: `space` 링크 토글 · `t` 타깃 전환 · `c` 복사모드 · `esc` 뒤로.
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
bun test                                    # 38개
bunx tsc --noEmit --noUnusedLocals          # 타입 + 데드코드 체크
```

`useInput`은 ink-testing-library + Bun에서 안 돌아간다. 그래서 키보드 로직은 순수 `keymap`
단위테스트로 덮고, 실제 대화형 조작은 `SMOKE.md`의 수동 TTY 체크리스트로 확인한다.

## 로드맵 (P3)

- git `fetch` 배선(대시보드 ahead/behind 정확도)
- TUI 에이전트 전환 + 타깃 피커(현재 `h`는 첫 타깃 헬스)
- `bun build --compile` 단일 바이너리
